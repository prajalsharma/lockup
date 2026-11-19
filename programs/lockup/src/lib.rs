//! # LOCKUP
//!
//! Sealed-bid storage units. A unit holds tokens nobody can see; three clues go on the door;
//! bids are sealed on a MagicBlock Private Ephemeral Rollup; the highest bid takes the unit.
//!
//! ## Where each instruction runs
//!
//! | Layer | Instructions |
//! |---|---|
//! | Solana | `init_yard`, `add_item`, `faucet`, `create_unit`, `request_draw`, `draw_callback`, `join_unit`, `start_unit`, `delegate_unit`, `settle_bidder`, `claim_lot`, `reclaim_stalled` |
//! | Private rollup | `init_unit_permission`, `stock_unit`, `seal_manifest`, `place_bid`, `seal_bid`, `close_unit`, `commit_unit` |
//!
//! ## How the contents stay hidden and still can't be rigged
//!
//! The operator commits to a salt when the unit is created. MagicBlock VRF then supplies
//! public randomness. Contents are derived from `sha256(randomness, salt, unit)` inside the
//! private rollup, so the operator cannot choose them (the randomness arrives after the
//! commitment) and nobody else can compute them (the salt is private until close). At close
//! the salt is published and anyone can recompute the unit.
//!
//! The delegation, permission and commit patterns follow MagicBlock's sealed-auction example
//! and `ephemeral-rollups-sdk` 0.16.2. Delegation buys privacy, not authorisation: every
//! instruction checks signer, PDA and state exactly as it would on plain Solana.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;
use anchor_lang::system_program::{transfer as transfer_lamports, Transfer as LamportsTransfer};
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer as SplTransfer};
use ephemeral_rollups_sdk::{
    access_control::{
        instructions::CreateEphemeralPermissionCpi,
        structs::{
            EphemeralMembersArgs, EphemeralPermission, Member, AUTHORITY_FLAG, PERMISSION_SEED,
            TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
        },
    },
    anchor::{commit, delegate, ephemeral, ephemeral_accounts, vrf, vrf_callback},
    consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
    cpi::DelegateConfig,
    ephem::MagicIntentBundleBuilder,
    vrf::{
        consts::{DEFAULT_QUEUE, DEFAULT_TEST_QUEUE},
        instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
        types::SerializableAccountMeta,
    },
};

pub mod engine;
pub mod error;
pub mod state;

use engine::{pick_winner, stock, ItemInfo, MAX_BIDDERS, MAX_ITEMS};
use error::LockupError;
use state::*;

declare_id!("2iCGfpC87DaSgdS62Fh2TaaEL7MnJeoA5vDBfdjoAAhR");

pub const YARD_SEED: &[u8] = b"yard";
pub const VAULT_SEED: &[u8] = b"vault";
pub const WAREHOUSE_SEED: &[u8] = b"warehouse";
pub const UNIT_SEED: &[u8] = b"unit";
pub const BIDDER_SEED: &[u8] = b"bidder";
pub const BID_SEED: &[u8] = b"bid";
pub const MANIFEST_SEED: &[u8] = b"manifest";
pub const TAP_SEED: &[u8] = b"tap";

pub const MIN_DURATION: i64 = 20;
pub const MAX_DURATION: i64 = 900;
/// After this long in line with no result on Solana, a bidder can take their deposit back.
pub const RECLAIM_SECONDS: i64 = 3600;
/// Test dollars per faucet call (6 decimals) and the wait between calls.
pub const FAUCET_AMOUNT: u64 = 500_000_000;
pub const FAUCET_COOLDOWN: i64 = 600;

fn reader(pubkey: Pubkey) -> Member {
    Member {
        flags: AUTHORITY_FLAG | TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG,
        pubkey,
    }
}

/// Lamports a unit must hold to sponsor every rollup account a full round can create.
/// Computed from the SDK's rent function; under-funding would fail mid-round.
fn sponsor_rent() -> Result<u64> {
    use ephemeral_rollups_sdk::ephemeral_accounts::rent;
    let perm = rent(EphemeralPermission::size_of(1) as u32);
    let bid = rent((8 + Bid::INIT_SPACE) as u32);
    let manifest = rent((8 + Manifest::INIT_SPACE) as u32);
    let per_bidder = bid.checked_add(perm).ok_or(LockupError::Overflow)?;
    per_bidder
        .checked_mul(MAX_BIDDERS as u64)
        .and_then(|v| v.checked_add(manifest))
        .and_then(|v| v.checked_add(perm.checked_mul(2)?))
        .ok_or_else(|| error!(LockupError::Overflow))
}

fn write_account<T: AccountSerialize>(info: &AccountInfo, value: &T) -> Result<()> {
    let mut data = info.try_borrow_mut_data()?;
    value.try_serialize(&mut &mut data[..])?;
    Ok(())
}

fn read_account<T: AccountDeserialize>(info: &AccountInfo) -> Result<T> {
    let data = info.try_borrow_data()?;
    let mut cursor = &data[..];
    T::try_deserialize(&mut cursor)
}

#[ephemeral]
#[program]
pub mod lockup {
    use super::*;

    // ------------------------------------------------------------ Solana: setup

    /// Create a yard, its deposit vault, and take over the test-dollar mint for the faucet.
    pub fn init_yard(ctx: Context<InitYard>, yard_id: u64) -> Result<()> {
        let yard = &mut ctx.accounts.yard;
        yard.authority = ctx.accounts.authority.key();
        yard.yard_id = yard_id;
        yard.bid_mint = ctx.accounts.bid_mint.key();
        yard.vault = ctx.accounts.vault.key();
        yard.unit_count = 0;
        yard.catalog = Vec::new();
        yard.bump = ctx.bumps.yard;
        Ok(())
    }

    /// Add one item type to the catalog and open its warehouse token account.
    pub fn add_item(
        ctx: Context<AddItem>,
        value: u32,
        weight: u16,
        rarity: u8,
        group: u8,
        heavy: bool,
    ) -> Result<()> {
        require!(value > 0 && weight > 0 && rarity <= 2, LockupError::InvalidItem);
        let yard = &mut ctx.accounts.yard;
        require!(yard.catalog.len() < MAX_ITEMS, LockupError::CatalogFull);
        let mint = ctx.accounts.item_mint.key();
        require!(yard.catalog.iter().all(|i| i.mint != mint), LockupError::InvalidItem);
        yard.catalog.push(Item { mint, value, weight, rarity, group, heavy });
        Ok(())
    }

    /// Mint test dollars to the caller. Devnet only; the mint has no value.
    pub fn faucet(ctx: Context<Faucet>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let tap = &mut ctx.accounts.tap;
        require!(
            tap.last == 0 || now >= tap.last.saturating_add(FAUCET_COOLDOWN),
            LockupError::FaucetCooldown
        );
        tap.last = now;
        tap.bump = ctx.bumps.tap;

        let id = ctx.accounts.yard.yard_id.to_le_bytes();
        let bump = [ctx.accounts.yard.bump];
        let seeds: &[&[u8]] = &[YARD_SEED, &id, &bump];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                MintTo {
                    mint: ctx.accounts.bid_mint.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.yard.to_account_info(),
                },
                &[seeds],
            ),
            FAUCET_AMOUNT,
        )
    }

    /// Open a unit. `salt_commit` is sha256 of a salt the operator keeps until close.
    pub fn create_unit(
        ctx: Context<CreateUnit>,
        unit_id: u64,
        duration: i64,
        min_bid: u64,
        salt_commit: [u8; 32],
    ) -> Result<()> {
        require!((MIN_DURATION..=MAX_DURATION).contains(&duration), LockupError::InvalidDuration);
        require!(min_bid > 0, LockupError::InvalidMinBid);
        require!(!ctx.accounts.yard.catalog.is_empty(), LockupError::InvalidItem);

        transfer_lamports(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                LamportsTransfer {
                    from: ctx.accounts.authority.to_account_info(),
                    to: ctx.accounts.unit.to_account_info(),
                },
            ),
            sponsor_rent()?,
        )?;

        let unit = &mut ctx.accounts.unit;
        unit.yard = ctx.accounts.yard.key();
        unit.unit_id = unit_id;
        unit.authority = ctx.accounts.authority.key();
        unit.status = UnitStatus::Created;
        unit.min_bid = min_bid;
        unit.duration = duration;
        unit.closes_at = 0;
        unit.salt_commit = salt_commit;
        unit.randomness = [0; 32];
        unit.stocked = false;
        unit.clues = [Clue::default(); 3];
        unit.bid_count = 0;
        unit.slots = Vec::new();
        // The rollup only ever sees the unit, so the unit carries the catalog facts it needs.
        unit.catalog = ctx
            .accounts
            .yard
            .catalog
            .iter()
            .map(|i| ItemFacts { value: i.value, weight: i.weight, rarity: i.rarity, group: i.group, heavy: i.heavy })
            .collect();
        unit.winner = Pubkey::default();
        unit.winning_bid = 0;
        unit.lots = Vec::new();
        unit.value = 0;
        unit.salt = [0; 32];
        unit.claimed_mask = 0;
        unit.bump = ctx.bumps.unit;

        let yard = &mut ctx.accounts.yard;
        yard.unit_count = yard.unit_count.checked_add(1).ok_or(LockupError::Overflow)?;
        Ok(())
    }

    /// Ask MagicBlock VRF for the unit's randomness.
    pub fn request_draw(ctx: Context<RequestDraw>) -> Result<()> {
        require!(ctx.accounts.unit.status == UnitStatus::Created, LockupError::WrongStatus);
        let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.authority.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::DrawCallback::DISCRIMINATOR.to_vec(),
            caller_seed: ctx.accounts.unit.key().to_bytes(),
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: ctx.accounts.unit.key(),
                is_signer: false,
                is_writable: true,
            }]),
            ..Default::default()
        });
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.authority.to_account_info(), &ix)?;
        Ok(())
    }

    /// Called by the VRF program only. Stores the randomness and opens the line.
    pub fn draw_callback(ctx: Context<DrawCallback>, randomness: [u8; 32]) -> Result<()> {
        let unit = &mut ctx.accounts.unit;
        require!(unit.status == UnitStatus::Created, LockupError::WrongStatus);
        unit.randomness = randomness;
        unit.status = UnitStatus::Open;
        msg!("Unit {} drawn", unit.unit_id);
        Ok(())
    }

    /// Get in line: escrow a deposit on Solana. The deposit is public and caps your bid.
    pub fn join_unit(ctx: Context<JoinUnit>, deposit: u64) -> Result<()> {
        let unit = &ctx.accounts.unit;
        require!(unit.status == UnitStatus::Open, LockupError::WrongStatus);
        require!(unit.slots.len() < MAX_BIDDERS, LockupError::UnitFull);
        require!(deposit >= unit.min_bid, LockupError::DepositTooSmall);
        let who = ctx.accounts.bidder.key();
        require!(unit.slot_index(&who).is_none(), LockupError::AlreadyJoined);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.bidder_token_account.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.bidder.to_account_info(),
                },
            ),
            deposit,
        )?;

        let record = &mut ctx.accounts.bidder_record;
        record.yard = ctx.accounts.yard.key();
        record.unit = ctx.accounts.unit.key();
        record.bidder = who;
        record.deposit = deposit;
        record.joined_at = Clock::get()?.unix_timestamp;
        record.settled = false;
        record.won = false;
        record.bump = ctx.bumps.bidder_record;

        ctx.accounts.unit.slots.push(Slot { bidder: who, deposit, has_bid: false, bid: 0 });
        Ok(())
    }

    /// Close the line and start the clock. Runs just before delegation.
    pub fn start_unit(ctx: Context<AuthorityUnit>) -> Result<()> {
        let unit = &mut ctx.accounts.unit;
        require!(unit.status == UnitStatus::Open, LockupError::WrongStatus);
        require!(!unit.slots.is_empty(), LockupError::NotInLine);
        unit.closes_at = Clock::get()?
            .unix_timestamp
            .checked_add(unit.duration)
            .ok_or(LockupError::Overflow)?;
        unit.status = UnitStatus::Bidding;
        Ok(())
    }

    /// Hand the unit to the private rollup's validator for the bidding phase.
    pub fn delegate_unit(ctx: Context<DelegateUnit>, unit_id: u64) -> Result<()> {
        {
            let unit: Unit = read_account(&ctx.accounts.unit.to_account_info())?;
            require_keys_eq!(unit.authority, ctx.accounts.authority.key(), LockupError::Unauthorized);
            require!(unit.status == UnitStatus::Bidding, LockupError::WrongStatus);
            require_eq!(unit.unit_id, unit_id, LockupError::InvalidAccount);
        }
        let yard = ctx.accounts.yard.key();
        let id = unit_id.to_le_bytes();
        let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
        ctx.accounts.delegate_unit(
            &ctx.accounts.authority,
            &[UNIT_SEED, yard.as_ref(), &id],
            DelegateConfig { validator, ..Default::default() },
        )?;
        Ok(())
    }

    // ---------------------------------------------------------- private rollup

    /// The unit itself is public on the rollup: clock, clues and who is in line.
    pub fn init_unit_permission(ctx: Context<UnitPermission>) -> Result<()> {
        if ctx.accounts.permission.lamports() > 0 {
            return Ok(());
        }
        let yard = ctx.accounts.unit.yard;
        let id = ctx.accounts.unit.unit_id.to_le_bytes();
        let bump = [ctx.accounts.unit.bump];
        let signers: &[&[u8]] = &[UNIT_SEED, yard.as_ref(), &id, &bump];
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.unit.to_account_info(),
            permissioned_account: ctx.accounts.unit.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: false,
                members: vec![reader(ctx.accounts.unit.authority)],
            },
        }
        .invoke_signed(&[signers])?;
        Ok(())
    }

    /// Derive the contents from randomness + salt, hide them in a manifest, post three clues.
    /// Send `seal_manifest` in the same transaction.
    pub fn stock_unit(ctx: Context<StockUnit>, salt: [u8; 32]) -> Result<()> {
        let unit = &ctx.accounts.unit;
        require!(unit.status == UnitStatus::Bidding, LockupError::WrongStatus);
        require!(!unit.stocked, LockupError::AlreadyStocked);
        require!(hashv(&[&salt]).to_bytes() == unit.salt_commit, LockupError::BadSalt);

        let unit_key = unit.key();
        let seed = hashv(&[&unit.randomness, &salt, unit_key.as_ref()]).to_bytes();
        let catalog: Vec<ItemInfo> = unit
            .catalog
            .iter()
            .map(|i| ItemInfo { value: i.value, weight: i.weight, rarity: i.rarity, group: i.group, heavy: i.heavy })
            .collect();
        let stocked = stock(&seed, &catalog).map_err(|_| error!(LockupError::StockFailed))?;

        ctx.accounts
            .create_ephemeral_manifest((8 + Manifest::INIT_SPACE) as u32)?;
        let manifest = Manifest {
            unit: unit_key,
            lots: stocked.lots.iter().map(|l| Lot { item: l.item, qty: l.qty }).collect(),
            value: stocked.value,
            salt,
            bump: ctx.bumps.manifest,
        };
        write_account(&ctx.accounts.manifest.to_account_info(), &manifest)?;

        let unit = &mut ctx.accounts.unit;
        for (i, c) in stocked.clues.iter().enumerate() {
            unit.clues[i] = Clue { kind: c.kind, arg: c.arg };
        }
        unit.stocked = true;
        // Deliberately logs nothing about the contents.
        msg!("Unit {} stocked", unit.unit_id);
        Ok(())
    }

    /// Make the manifest private: only the operator, who already knows the salt, can read it.
    pub fn seal_manifest(ctx: Context<SealManifest>) -> Result<()> {
        if !ctx.accounts.permission.data_is_empty() {
            return Ok(());
        }
        let yard = ctx.accounts.unit.yard;
        let id = ctx.accounts.unit.unit_id.to_le_bytes();
        let unit_bump = [ctx.accounts.unit.bump];
        let unit_signers: &[&[u8]] = &[UNIT_SEED, yard.as_ref(), &id, &unit_bump];
        let unit_key = ctx.accounts.unit.key();
        let manifest_bump = [ctx.accounts.manifest.bump];
        let manifest_signers: &[&[u8]] = &[MANIFEST_SEED, unit_key.as_ref(), &manifest_bump];

        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.unit.to_account_info(),
            permissioned_account: ctx.accounts.manifest.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![reader(ctx.accounts.unit.authority)],
            },
        }
        .invoke_signed(&[unit_signers, manifest_signers])?;
        Ok(())
    }

    /// Place a bid. Send `seal_bid` in the same transaction.
    pub fn place_bid(ctx: Context<PlaceBid>, amount: u64) -> Result<()> {
        let unit = &ctx.accounts.unit;
        require!(unit.status == UnitStatus::Bidding, LockupError::WrongStatus);
        require!(unit.stocked, LockupError::NotStocked);
        require!(Clock::get()?.unix_timestamp < unit.closes_at, LockupError::BiddingClosed);

        let who = ctx.accounts.bidder.key();
        let index = unit.slot_index(&who).ok_or(LockupError::NotInLine)?;
        require!(!unit.slots[index].has_bid, LockupError::AlreadyBid);
        require!(amount >= unit.min_bid, LockupError::BidTooLow);
        // The check that stops an unfunded bid: it can never exceed what is escrowed on Solana.
        require!(amount <= unit.slots[index].deposit, LockupError::BidAboveDeposit);

        let order = unit.bid_count;
        let unit_key = unit.key();
        ctx.accounts.create_ephemeral_bid((8 + Bid::INIT_SPACE) as u32)?;
        let bid = Bid { unit: unit_key, bidder: who, amount, order, bump: ctx.bumps.bid };
        write_account(&ctx.accounts.bid.to_account_info(), &bid)?;

        let unit = &mut ctx.accounts.unit;
        unit.slots[index].has_bid = true;
        unit.bid_count = unit.bid_count.checked_add(1).ok_or(LockupError::Overflow)?;
        // Deliberately does not log the amount.
        msg!("Bid {} sealed on unit {}", order, unit.unit_id);
        Ok(())
    }

    /// Make a bid private: only its bidder can read it. Not even the operator.
    pub fn seal_bid(ctx: Context<SealBid>) -> Result<()> {
        if !ctx.accounts.permission.data_is_empty() {
            return Ok(());
        }
        let bidder = ctx.accounts.bid.bidder;
        let yard = ctx.accounts.unit.yard;
        let id = ctx.accounts.unit.unit_id.to_le_bytes();
        let unit_bump = [ctx.accounts.unit.bump];
        let unit_signers: &[&[u8]] = &[UNIT_SEED, yard.as_ref(), &id, &unit_bump];
        let unit_key = ctx.accounts.unit.key();
        let bid_bump = [ctx.accounts.bid.bump];
        let bid_signers: &[&[u8]] = &[BID_SEED, unit_key.as_ref(), bidder.as_ref(), &bid_bump];

        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.unit.to_account_info(),
            permissioned_account: ctx.accounts.bid.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs { is_private: true, members: vec![reader(bidder)] },
        }
        .invoke_signed(&[unit_signers, bid_signers])?;
        Ok(())
    }

    /// Read every sealed bid at once, pick the winner, and write bids, contents and salt into
    /// the unit so they travel to Solana with the commit.
    ///
    /// `remaining_accounts` = the manifest, then every bid. Each is checked to be the PDA
    /// this program derives, so nobody can pass a forged bid or a different manifest.
    pub fn close_unit(ctx: Context<CloseUnit>) -> Result<()> {
        let unit_key = ctx.accounts.unit.key();
        {
            let unit = &ctx.accounts.unit;
            require!(unit.status == UnitStatus::Bidding, LockupError::WrongStatus);
            require!(unit.stocked, LockupError::NotStocked);
            require!(Clock::get()?.unix_timestamp >= unit.closes_at, LockupError::BiddingStillOpen);
            require_eq!(
                ctx.remaining_accounts.len(),
                unit.bid_count as usize + 1,
                LockupError::BidCountMismatch
            );
        }

        let manifest_info = &ctx.remaining_accounts[0];
        let expected = Pubkey::find_program_address(&[MANIFEST_SEED, unit_key.as_ref()], ctx.program_id).0;
        require_keys_eq!(manifest_info.key(), expected, LockupError::InvalidAccount);
        require_keys_eq!(*manifest_info.owner, *ctx.program_id, LockupError::InvalidAccount);
        let manifest: Manifest = read_account(manifest_info)?;
        require_keys_eq!(manifest.unit, unit_key, LockupError::InvalidAccount);

        let bid_infos = &ctx.remaining_accounts[1..];
        let mut bids: Vec<Bid> = Vec::with_capacity(bid_infos.len());
        for (i, info) in bid_infos.iter().enumerate() {
            for previous in bid_infos.iter().take(i) {
                require_keys_neq!(info.key(), previous.key(), LockupError::DuplicateBid);
            }
            let bid: Bid = read_account(info)?;
            require_keys_eq!(bid.unit, unit_key, LockupError::InvalidAccount);
            let expected = Pubkey::find_program_address(
                &[BID_SEED, unit_key.as_ref(), bid.bidder.as_ref()],
                ctx.program_id,
            )
            .0;
            require_keys_eq!(info.key(), expected, LockupError::InvalidAccount);
            require_keys_eq!(*info.owner, *ctx.program_id, LockupError::InvalidAccount);
            bids.push(bid);
        }

        let unit = &mut ctx.accounts.unit;
        for bid in &bids {
            let index = unit.slot_index(&bid.bidder).ok_or(LockupError::NotInLine)?;
            // Re-checked here so a bid can never settle above its escrow.
            require!(bid.amount <= unit.slots[index].deposit, LockupError::BidAboveDeposit);
            unit.slots[index].bid = bid.amount;
        }
        let ranked: Vec<(u64, u8)> = bids.iter().map(|b| (b.amount, b.order)).collect();
        if let Some(w) = pick_winner(&ranked) {
            unit.winner = bids[w].bidder;
            unit.winning_bid = bids[w].amount;
        }
        unit.lots = manifest.lots.clone();
        unit.value = manifest.value;
        unit.salt = manifest.salt;
        unit.status = UnitStatus::Closed;
        msg!("Unit {} closed with {} bids", unit.unit_id, bids.len());
        Ok(())
    }

    /// Commit the closed unit to Solana and release it from the rollup.
    ///
    /// Must not modify the unit: `commit_and_undelegate` hands the account to the Magic
    /// program inside this instruction, so any write (including Anchor's exit write on a
    /// typed `mut` account) is rejected. Hence `UncheckedAccount` and hand validation.
    pub fn commit_unit(ctx: Context<CommitUnit>) -> Result<()> {
        {
            let unit: Unit = read_account(&ctx.accounts.unit.to_account_info())?;
            let expected = Pubkey::find_program_address(
                &[UNIT_SEED, unit.yard.as_ref(), &unit.unit_id.to_le_bytes()],
                ctx.program_id,
            )
            .0;
            require_keys_eq!(ctx.accounts.unit.key(), expected, LockupError::InvalidAccount);
            require!(unit.status == UnitStatus::Closed, LockupError::WrongStatus);
            require_keys_eq!(unit.authority, ctx.accounts.authority.key(), LockupError::Unauthorized);
        }
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.unit.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    // ------------------------------------------------------- Solana: settlement

    /// Pay one bidder what they are owed. Anyone can run it: the numbers come from the unit.
    /// The winner gets their deposit minus the winning bid. Everyone else gets it all back.
    pub fn settle_bidder(ctx: Context<SettleBidder>) -> Result<()> {
        let unit = &ctx.accounts.unit;
        require!(unit.status == UnitStatus::Closed, LockupError::WrongStatus);
        let record = &ctx.accounts.bidder_record;
        require!(!record.settled, LockupError::AlreadySettled);

        let won = unit.winner == record.bidder && unit.winner != Pubkey::default();
        let payout = if won {
            record.deposit.checked_sub(unit.winning_bid).ok_or(LockupError::Overflow)?
        } else {
            record.deposit
        };

        if payout > 0 {
            let id = ctx.accounts.yard.yard_id.to_le_bytes();
            let bump = [ctx.accounts.yard.bump];
            let seeds: &[&[u8]] = &[YARD_SEED, &id, &bump];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    SplTransfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.bidder_token_account.to_account_info(),
                        authority: ctx.accounts.yard.to_account_info(),
                    },
                    &[seeds],
                ),
                payout,
            )?;
        }
        let record = &mut ctx.accounts.bidder_record;
        record.settled = true;
        record.won = won;
        Ok(())
    }

    /// Move one lot of the contents from the warehouse to the winner. Anyone can run it.
    pub fn claim_lot(ctx: Context<ClaimLot>, lot_index: u8) -> Result<()> {
        let unit = &ctx.accounts.unit;
        require!(unit.status == UnitStatus::Closed, LockupError::WrongStatus);
        // `won` is only set by `settle_bidder`, so a winner who reclaimed a stalled deposit
        // instead of paying can never collect the contents.
        require!(ctx.accounts.bidder_record.won, LockupError::NotWinner);
        let i = lot_index as usize;
        require!(i < unit.lots.len(), LockupError::InvalidAccount);
        require!(unit.claimed_mask & (1 << lot_index) == 0, LockupError::AlreadyClaimed);

        let lot = unit.lots[i];
        let item = ctx.accounts.yard.catalog.get(lot.item as usize).ok_or(LockupError::InvalidAccount)?;
        require_keys_eq!(item.mint, ctx.accounts.item_mint.key(), LockupError::MintMismatch);

        let id = ctx.accounts.yard.yard_id.to_le_bytes();
        let bump = [ctx.accounts.yard.bump];
        let seeds: &[&[u8]] = &[YARD_SEED, &id, &bump];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.warehouse.to_account_info(),
                    to: ctx.accounts.winner_token_account.to_account_info(),
                    authority: ctx.accounts.yard.to_account_info(),
                },
                &[seeds],
            ),
            lot.qty as u64,
        )?;
        ctx.accounts.unit.claimed_mask |= 1 << lot_index;
        Ok(())
    }

    /// Escape hatch: an hour after joining, if the unit has no result on Solana, take the
    /// whole deposit back. Works even while the unit is still held by the rollup.
    pub fn reclaim_stalled(ctx: Context<ReclaimStalled>) -> Result<()> {
        let record = &ctx.accounts.bidder_record;
        require!(!record.settled, LockupError::AlreadySettled);
        require!(
            Clock::get()?.unix_timestamp >= record.joined_at.saturating_add(RECLAIM_SECONDS),
            LockupError::TooEarly
        );
        // A unit back on Solana with a result must be settled the normal way.
        let unit_info = ctx.accounts.unit.to_account_info();
        if *unit_info.owner == crate::ID {
            let unit: Unit = read_account(&unit_info)?;
            require!(unit.status != UnitStatus::Closed, LockupError::WrongStatus);
        }

        let id = ctx.accounts.yard.yard_id.to_le_bytes();
        let bump = [ctx.accounts.yard.bump];
        let seeds: &[&[u8]] = &[YARD_SEED, &id, &bump];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.bidder_token_account.to_account_info(),
                    authority: ctx.accounts.yard.to_account_info(),
                },
                &[seeds],
            ),
            record.deposit,
        )?;
        ctx.accounts.bidder_record.settled = true;
        Ok(())
    }
}

// ============================================================ account contexts

#[derive(Accounts)]
#[instruction(yard_id: u64)]
pub struct InitYard<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Yard::INIT_SPACE, seeds = [YARD_SEED, &yard_id.to_le_bytes()], bump)]
    pub yard: Box<Account<'info, Yard>>,
    /// Its mint authority must already be the yard PDA so the faucet works.
    #[account(constraint = bid_mint.mint_authority == anchor_lang::solana_program::program_option::COption::Some(yard.key()) @ LockupError::MintMismatch)]
    pub bid_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = authority, token::mint = bid_mint, token::authority = yard, seeds = [VAULT_SEED, yard.key().as_ref()], bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddItem<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [YARD_SEED, &yard.yard_id.to_le_bytes()], bump = yard.bump, has_one = authority @ LockupError::Unauthorized)]
    pub yard: Box<Account<'info, Yard>>,
    pub item_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = authority, token::mint = item_mint, token::authority = yard, seeds = [WAREHOUSE_SEED, yard.key().as_ref(), item_mint.key().as_ref()], bump)]
    pub warehouse: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Faucet<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [YARD_SEED, &yard.yard_id.to_le_bytes()], bump = yard.bump)]
    pub yard: Box<Account<'info, Yard>>,
    #[account(mut, address = yard.bid_mint @ LockupError::MintMismatch)]
    pub bid_mint: Box<Account<'info, Mint>>,
    #[account(mut, constraint = user_token_account.owner == user.key() @ LockupError::Unauthorized, constraint = user_token_account.mint == yard.bid_mint @ LockupError::MintMismatch)]
    pub user_token_account: Box<Account<'info, TokenAccount>>,
    #[account(init_if_needed, payer = user, space = 8 + Tap::INIT_SPACE, seeds = [TAP_SEED, yard.key().as_ref(), user.key().as_ref()], bump)]
    pub tap: Box<Account<'info, Tap>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(unit_id: u64)]
pub struct CreateUnit<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [YARD_SEED, &yard.yard_id.to_le_bytes()], bump = yard.bump, has_one = authority @ LockupError::Unauthorized)]
    pub yard: Box<Account<'info, Yard>>,
    #[account(init, payer = authority, space = 8 + Unit::INIT_SPACE, seeds = [UNIT_SEED, yard.key().as_ref(), &unit_id.to_le_bytes()], bump)]
    pub unit: Box<Account<'info, Unit>>,
    pub system_program: Program<'info, System>,
}

#[vrf]
#[derive(Accounts)]
pub struct RequestDraw<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [UNIT_SEED, unit.yard.as_ref(), &unit.unit_id.to_le_bytes()], bump = unit.bump, has_one = authority @ LockupError::Unauthorized)]
    pub unit: Box<Account<'info, Unit>>,
    /// CHECK: MagicBlock's oracle queue, pinned to the known addresses.
    #[account(mut, constraint = oracle_queue.key() == DEFAULT_QUEUE || oracle_queue.key() == DEFAULT_TEST_QUEUE @ LockupError::InvalidAccount)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct DrawCallback<'info> {
    #[account(mut, seeds = [UNIT_SEED, unit.yard.as_ref(), &unit.unit_id.to_le_bytes()], bump = unit.bump)]
    pub unit: Box<Account<'info, Unit>>,
}

#[derive(Accounts)]
pub struct JoinUnit<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,
    #[account(seeds = [YARD_SEED, &yard.yard_id.to_le_bytes()], bump = yard.bump)]
    pub yard: Box<Account<'info, Yard>>,
    #[account(mut, seeds = [UNIT_SEED, yard.key().as_ref(), &unit.unit_id.to_le_bytes()], bump = unit.bump, constraint = unit.yard == yard.key() @ LockupError::InvalidAccount)]
    pub unit: Box<Account<'info, Unit>>,
    #[account(init, payer = bidder, space = 8 + Bidder::INIT_SPACE, seeds = [BIDDER_SEED, unit.key().as_ref(), bidder.key().as_ref()], bump)]
    pub bidder_record: Box<Account<'info, Bidder>>,
    #[account(mut, constraint = bidder_token_account.owner == bidder.key() @ LockupError::Unauthorized, constraint = bidder_token_account.mint == yard.bid_mint @ LockupError::MintMismatch)]
    pub bidder_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [VAULT_SEED, yard.key().as_ref()], bump, constraint = vault.key() == yard.vault @ LockupError::InvalidAccount)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AuthorityUnit<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [UNIT_SEED, unit.yard.as_ref(), &unit.unit_id.to_le_bytes()], bump = unit.bump, has_one = authority @ LockupError::Unauthorized)]
    pub unit: Box<Account<'info, Unit>>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(unit_id: u64)]
pub struct DelegateUnit<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [YARD_SEED, &yard.yard_id.to_le_bytes()], bump = yard.bump)]
    pub yard: Box<Account<'info, Yard>>,
    /// CHECK: validated by hand in the handler; the delegation CPI takes ownership of it.
    #[account(mut, del, seeds = [UNIT_SEED, yard.key().as_ref(), &unit_id.to_le_bytes()], bump)]
    pub unit: UncheckedAccount<'info>,
    /// CHECK: the validator to delegate to (the TEE validator for the private rollup).
    pub validator: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct UnitPermission<'info> {
    #[account(mut, seeds = [UNIT_SEED, unit.yard.as_ref(), &unit.unit_id.to_le_bytes()], bump = unit.bump)]
    pub unit: Box<Account<'info, Unit>>,
    /// CHECK: permission PDA for the unit.
    #[account(mut, seeds = [PERMISSION_SEED, unit.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: address-pinned.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: address-pinned.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: address-pinned.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[ephemeral_accounts]
#[derive(Accounts)]
pub struct StockUnit<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, sponsor, seeds = [UNIT_SEED, unit.yard.as_ref(), &unit.unit_id.to_le_bytes()], bump = unit.bump, has_one = authority @ LockupError::Unauthorized)]
    pub unit: Box<Account<'info, Unit>>,
    /// CHECK: created here as an ephemeral account.
    #[account(mut, eph, seeds = [MANIFEST_SEED, unit.key().as_ref()], bump)]
    pub manifest: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SealManifest<'info> {
    #[account(mut, seeds = [UNIT_SEED, unit.yard.as_ref(), &unit.unit_id.to_le_bytes()], bump = unit.bump)]
    pub unit: Box<Account<'info, Unit>>,
    #[account(mut, seeds = [MANIFEST_SEED, unit.key().as_ref()], bump = manifest.bump, constraint = manifest.unit == unit.key() @ LockupError::InvalidAccount)]
    pub manifest: Box<Account<'info, Manifest>>,
    /// CHECK: permission PDA for the manifest.
    #[account(mut, seeds = [PERMISSION_SEED, manifest.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: address-pinned.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: address-pinned.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: address-pinned.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[ephemeral_accounts]
#[derive(Accounts)]
pub struct PlaceBid<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,
    #[account(mut, sponsor, seeds = [UNIT_SEED, unit.yard.as_ref(), &unit.unit_id.to_le_bytes()], bump = unit.bump)]
    pub unit: Box<Account<'info, Unit>>,
    /// CHECK: created here as an ephemeral account.
    #[account(mut, eph, seeds = [BID_SEED, unit.key().as_ref(), bidder.key().as_ref()], bump)]
    pub bid: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SealBid<'info> {
    #[account(mut, seeds = [UNIT_SEED, unit.yard.as_ref(), &unit.unit_id.to_le_bytes()], bump = unit.bump)]
    pub unit: Box<Account<'info, Unit>>,
    #[account(mut, seeds = [BID_SEED, unit.key().as_ref(), bid.bidder.as_ref()], bump = bid.bump, constraint = bid.unit == unit.key() @ LockupError::InvalidAccount)]
    pub bid: Box<Account<'info, Bid>>,
    /// CHECK: permission PDA for the bid.
    #[account(mut, seeds = [PERMISSION_SEED, bid.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: address-pinned.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: address-pinned.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: address-pinned.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CloseUnit<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [UNIT_SEED, unit.yard.as_ref(), &unit.unit_id.to_le_bytes()], bump = unit.bump, has_one = authority @ LockupError::Unauthorized)]
    pub unit: Box<Account<'info, Unit>>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitUnit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub authority: Signer<'info>,
    /// CHECK: validated by hand in the handler; see `commit_unit`.
    #[account(mut)]
    pub unit: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SettleBidder<'info> {
    #[account(mut)]
    pub crank: Signer<'info>,
    #[account(seeds = [YARD_SEED, &yard.yard_id.to_le_bytes()], bump = yard.bump)]
    pub yard: Box<Account<'info, Yard>>,
    #[account(seeds = [UNIT_SEED, yard.key().as_ref(), &unit.unit_id.to_le_bytes()], bump = unit.bump, constraint = unit.yard == yard.key() @ LockupError::InvalidAccount)]
    pub unit: Box<Account<'info, Unit>>,
    #[account(mut, seeds = [BIDDER_SEED, unit.key().as_ref(), bidder_record.bidder.as_ref()], bump = bidder_record.bump, constraint = bidder_record.unit == unit.key() @ LockupError::InvalidAccount)]
    pub bidder_record: Box<Account<'info, Bidder>>,
    #[account(mut, constraint = bidder_token_account.owner == bidder_record.bidder @ LockupError::Unauthorized, constraint = bidder_token_account.mint == yard.bid_mint @ LockupError::MintMismatch)]
    pub bidder_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [VAULT_SEED, yard.key().as_ref()], bump, constraint = vault.key() == yard.vault @ LockupError::InvalidAccount)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimLot<'info> {
    #[account(mut)]
    pub crank: Signer<'info>,
    #[account(seeds = [YARD_SEED, &yard.yard_id.to_le_bytes()], bump = yard.bump)]
    pub yard: Box<Account<'info, Yard>>,
    #[account(mut, seeds = [UNIT_SEED, yard.key().as_ref(), &unit.unit_id.to_le_bytes()], bump = unit.bump, constraint = unit.yard == yard.key() @ LockupError::InvalidAccount)]
    pub unit: Box<Account<'info, Unit>>,
    #[account(seeds = [BIDDER_SEED, unit.key().as_ref(), unit.winner.as_ref()], bump = bidder_record.bump)]
    pub bidder_record: Box<Account<'info, Bidder>>,
    pub item_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [WAREHOUSE_SEED, yard.key().as_ref(), item_mint.key().as_ref()], bump)]
    pub warehouse: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = winner_token_account.owner == unit.winner @ LockupError::NotWinner, constraint = winner_token_account.mint == item_mint.key() @ LockupError::MintMismatch)]
    pub winner_token_account: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ReclaimStalled<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,
    #[account(seeds = [YARD_SEED, &yard.yard_id.to_le_bytes()], bump = yard.bump)]
    pub yard: Box<Account<'info, Yard>>,
    /// CHECK: may be owned by the delegation program while stuck on the rollup. Tied to the
    /// bidder record by address; the record names its yard.
    #[account(address = bidder_record.unit @ LockupError::InvalidAccount)]
    pub unit: UncheckedAccount<'info>,
    #[account(mut, seeds = [BIDDER_SEED, unit.key().as_ref(), bidder.key().as_ref()], bump = bidder_record.bump, constraint = bidder_record.bidder == bidder.key() @ LockupError::Unauthorized, constraint = bidder_record.yard == yard.key() @ LockupError::InvalidAccount)]
    pub bidder_record: Box<Account<'info, Bidder>>,
    #[account(mut, constraint = bidder_token_account.owner == bidder.key() @ LockupError::Unauthorized, constraint = bidder_token_account.mint == yard.bid_mint @ LockupError::MintMismatch)]
    pub bidder_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [VAULT_SEED, yard.key().as_ref()], bump, constraint = vault.key() == yard.vault @ LockupError::InvalidAccount)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}
