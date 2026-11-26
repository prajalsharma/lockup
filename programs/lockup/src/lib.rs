//! # LOCKUP
//!
//! Sealed-bid storage units. A unit holds tokens nobody can see; three clues go on the door;
//! bids are sealed on a MagicBlock Private Ephemeral Rollup; the highest bid takes the unit.
//!
//! ## Where each instruction runs
//!
//! | Layer | Instructions |
//! |---|---|
//! | Solana | `init_yard`, `add_item`, `create_unit`, `join_unit`, `start_unit` (locks the line and requests the VRF draw), `draw_callback`, `request_draw` (retry only), `delegate_unit`, `settle_bidder`, `settle_on_commit` (Magic Action), `claim_lot`, `reclaim_stalled`, `list_item`, `buy_item`, `cancel_listing`, `init_pool`, `consign`, `withdraw_consignment` |
//! | Private rollup | `init_unit_permission`, `stock_unit`, `seal_manifest`, `place_bid`, `seal_bid`, `close_unit`, `commit_unit`, `commit_and_settle` (commit plus a Magic Action per bidder that pays them on Solana) |
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
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer as SplTransfer};
use ephemeral_rollups_sdk::{
    access_control::{
        instructions::CreateEphemeralPermissionCpi,
        structs::{
            EphemeralMembersArgs, EphemeralPermission, Member, AUTHORITY_FLAG, PERMISSION_SEED,
            TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
        },
    },
    anchor::{action, commit, delegate, ephemeral, ephemeral_accounts, vrf, vrf_callback},
    consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
    cpi::DelegateConfig,
    ephem::{CallHandler, MagicIntentBundleBuilder},
    vrf::{
        consts::{DEFAULT_QUEUE, DEFAULT_TEST_QUEUE},
        instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
        types::SerializableAccountMeta,
    },
};

use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};

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
pub const POOL_SEED: &[u8] = b"pool";
pub const CONSIGN_SEED: &[u8] = b"consign";
pub const UNIT_SEED: &[u8] = b"unit";
pub const BIDDER_SEED: &[u8] = b"bidder";
pub const BID_SEED: &[u8] = b"bid";
pub const MANIFEST_SEED: &[u8] = b"manifest";
pub const LISTING_SEED: &[u8] = b"listing";
pub const STALL_SEED: &[u8] = b"stall";

pub const MIN_DURATION: i64 = 20;
pub const MAX_DURATION: i64 = 900;
/// After this long in line with no result on Solana, a bidder can take their deposit back.
pub const RECLAIM_SECONDS: i64 = 3600;

/// MagicBlock's devnet Private Ephemeral Rollup validator.
pub const TEE_VALIDATOR: Pubkey = pubkey!("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
/// Bit of `claimed_mask` set once the winning bid has been paid to the operator.
pub const BID_PAID: u8 = 1 << 7;
/// Escrow index `ActionArgs::new` uses for the fees of actions scheduled at commit.
pub const ACTION_ESCROW_INDEX: u8 = 255;
/// Compute budget for one bidder's payout when it runs as a Magic Action.
pub const SETTLE_ACTION_UNITS: u32 = 120_000;

fn draw_request(payer: Pubkey, oracle_queue: Pubkey, unit: Pubkey) -> anchor_lang::solana_program::instruction::Instruction {
    create_request_scoped_randomness_ix(RequestRandomnessParams {
        payer,
        oracle_queue,
        callback_program_id: ID,
        callback_discriminator: instruction::DrawCallback::DISCRIMINATOR.to_vec(),
        caller_seed: unit.to_bytes(),
        accounts_metas: Some(vec![SerializableAccountMeta { pubkey: unit, is_signer: false, is_writable: true }]),
        ..Default::default()
    })
}

/// Pay one bidder what they are owed and mark their record. The winning bid is not paid out
/// here: it stays in the vault until the last lot has been delivered (`claim_lot`), so the
/// operator is paid only after the winner has everything.
fn pay_bidder<'info>(
    yard: &Account<'info, Yard>,
    unit: &Account<'info, Unit>,
    record: &mut Account<'info, Bidder>,
    bidder_token_account: AccountInfo<'info>,
    vault: AccountInfo<'info>,
    token_program: Pubkey,
) -> Result<()> {
    require!(unit.status == UnitStatus::Closed, LockupError::WrongStatus);
    require!(!record.settled, LockupError::AlreadySettled);
    let won = unit.winner == record.bidder && unit.winner != Pubkey::default();
    let payout = if won { record.deposit.checked_sub(unit.winning_bid).ok_or(LockupError::Overflow)? } else { record.deposit };
    if payout > 0 {
        let id = yard.yard_id.to_le_bytes();
        let bump = [yard.bump];
        let seeds: &[&[u8]] = &[YARD_SEED, &id, &bump];
        token::transfer(
            CpiContext::new_with_signer(token_program, SplTransfer { from: vault, to: bidder_token_account, authority: yard.to_account_info() }, &[seeds]),
            payout,
        )?;
    }
    record.settled = true;
    record.won = won;
    Ok(())
}

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

    /// Open a unit for people to line up. `salt_commit` is sha256 of a salt the operator keeps until close.
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
        // The line opens at once. The random draw is not requested until the line locks, so
        // nobody, the operator included, can know a unit's contents while people are still deciding
        // whether to join it.
        unit.status = UnitStatus::Open;
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

    /// Ask MagicBlock VRF again for a locked unit whose draw has not arrived. `start_unit` makes
    /// the first request; this exists only so a lost request cannot strand a unit.
    pub fn request_draw(ctx: Context<RequestDraw>) -> Result<()> {
        let unit = &ctx.accounts.unit;
        // `Created` is how units made before the draw moved behind the lock wait for theirs.
        require!(unit.status == UnitStatus::Bidding || unit.status == UnitStatus::Created, LockupError::WrongStatus);
        require!(unit.randomness == [0; 32], LockupError::AlreadyDrawn);
        let ix = draw_request(ctx.accounts.authority.key(), ctx.accounts.oracle_queue.key(), unit.key());
        ctx.accounts.invoke_signed_vrf(&ctx.accounts.authority.to_account_info(), &ix)?;
        Ok(())
    }

    /// Called by the VRF program only. Stores the randomness, once, and starts the bidding clock.
    pub fn draw_callback(ctx: Context<DrawCallback>, randomness: [u8; 32]) -> Result<()> {
        let unit = &mut ctx.accounts.unit;
        require!(unit.randomness == [0; 32], LockupError::AlreadyDrawn);
        match unit.status {
            UnitStatus::Bidding => {
                // The clock starts when the draw lands, so waiting for it costs bidders no time.
                unit.closes_at = Clock::get()?.unix_timestamp.checked_add(unit.duration).ok_or(LockupError::Overflow)?;
            }
            UnitStatus::Created => unit.status = UnitStatus::Open,
            _ => return err!(LockupError::WrongStatus),
        }
        unit.randomness = randomness;
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

    /// Lock the line and ask MagicBlock VRF for the unit's randomness. From here nobody can
    /// join or leave, and only now is the draw requested.
    pub fn start_unit(ctx: Context<RequestDraw>) -> Result<()> {
        let unit = &mut ctx.accounts.unit;
        require!(unit.status == UnitStatus::Open, LockupError::WrongStatus);
        require!(!unit.slots.is_empty(), LockupError::NotInLine);
        unit.closes_at = Clock::get()?.unix_timestamp.checked_add(unit.duration).ok_or(LockupError::Overflow)?;
        unit.status = UnitStatus::Bidding;
        // Units made before the draw moved behind the lock already have theirs.
        if unit.randomness == [0; 32] {
            let ix = draw_request(ctx.accounts.authority.key(), ctx.accounts.oracle_queue.key(), unit.key());
            ctx.accounts.invoke_signed_vrf(&ctx.accounts.authority.to_account_info(), &ix)?;
        }
        Ok(())
    }

    /// Hand the unit to the private rollup's validator for the bidding phase.
    pub fn delegate_unit(ctx: Context<DelegateUnit>, unit_id: u64) -> Result<()> {
        {
            let unit: Unit = read_account(&ctx.accounts.unit.to_account_info())?;
            require_keys_eq!(unit.authority, ctx.accounts.authority.key(), LockupError::Unauthorized);
            require!(unit.status == UnitStatus::Bidding, LockupError::WrongStatus);
            // The contents are derived from the draw, so the unit cannot leave without it.
            require!(unit.randomness != [0; 32], LockupError::NotDrawn);
            require_eq!(unit.unit_id, unit_id, LockupError::InvalidAccount);
        }
        let yard = ctx.accounts.yard.key();
        let id = unit_id.to_le_bytes();
        // Only MagicBlock's private (TEE) validator may hold a unit: bids are only sealed there.
        let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
        require!(validator == Some(TEE_VALIDATOR), LockupError::InvalidAccount);
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
            // The door opens when the clock runs out, or as soon as everyone in line has bid:
            // the line is locked by now, so nobody is left who could still bid.
            let everyone_bid = unit.bid_count as usize == unit.slots.len();
            require!(everyone_bid || Clock::get()?.unix_timestamp >= unit.closes_at, LockupError::BiddingStillOpen);
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

    /// `commit_unit`, plus a Magic Action per bidder: as soon as the unit is back on Solana,
    /// MagicBlock runs `settle_on_commit` for each of them, so refunds and the winner's change
    /// arrive without anyone sending a settlement transaction. Remaining accounts are the
    /// bidders' token accounts in line order. The actions are not atomic with the commit; if one
    /// fails, `settle_bidder` still works.
    pub fn commit_and_settle<'info>(ctx: Context<'info, CommitAndSettle<'info>>) -> Result<()> {
        let unit: Unit = read_account(&ctx.accounts.unit.to_account_info())?;
        let expected = Pubkey::find_program_address(&[UNIT_SEED, unit.yard.as_ref(), &unit.unit_id.to_le_bytes()], ctx.program_id).0;
        require_keys_eq!(ctx.accounts.unit.key(), expected, LockupError::InvalidAccount);
        require!(unit.status == UnitStatus::Closed, LockupError::WrongStatus);
        require_keys_eq!(unit.authority, ctx.accounts.authority.key(), LockupError::Unauthorized);
        require_keys_eq!(unit.yard, ctx.accounts.yard.key(), LockupError::InvalidAccount);
        require!(ctx.remaining_accounts.len() == unit.slots.len(), LockupError::BidCountMismatch);

        let unit_key = ctx.accounts.unit.key();
        let data = anchor_lang::InstructionData::data(&crate::instruction::SettleOnCommit {});
        let meta = |pubkey: Pubkey, is_writable: bool| ShortAccountMeta { pubkey: pubkey.to_bytes().into(), is_writable };
        let actions: Vec<CallHandler> = unit
            .slots
            .iter()
            .zip(ctx.remaining_accounts.iter())
            .map(|(slot, token_account)| {
                let record = Pubkey::find_program_address(&[BIDDER_SEED, unit_key.as_ref(), slot.bidder.as_ref()], ctx.program_id).0;
                CallHandler {
                    destination_program: crate::ID,
                    accounts: vec![
                        meta(ctx.accounts.yard.key(), false),
                        meta(unit_key, false),
                        meta(record, true),
                        meta(token_account.key(), true),
                        meta(ctx.accounts.vault.key(), true),
                        meta(ctx.accounts.token_program.key(), false),
                    ],
                    args: ActionArgs::new(data.clone()),
                    // Fees for the actions come from the operator's escrow on Solana.
                    escrow_authority: ctx.accounts.payer.to_account_info(),
                    compute_units: SETTLE_ACTION_UNITS,
                }
            })
            .collect();

        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.unit.to_account_info()])
        .add_post_undelegate_actions(actions)
        .build_and_invoke()?;
        Ok(())
    }

    // ------------------------------------------------------- Solana: settlement

    /// Pay one bidder what they are owed. Anyone can run it: the numbers come from the unit.
    /// The winner gets their deposit minus the winning bid. Everyone else gets it all back.
    /// The winning bid itself waits in the vault for `claim_lot`.
    pub fn settle_bidder(ctx: Context<SettleBidder>) -> Result<()> {
        let a = ctx.accounts;
        pay_bidder(&a.yard, &a.unit, &mut a.bidder_record, a.bidder_token_account.to_account_info(), a.vault.to_account_info(), a.token_program.key())
    }

    /// The same payout as `settle_bidder`, run by MagicBlock as a Magic Action the moment the
    /// unit is back on Solana. Scheduled by `commit_and_settle`, one per bidder. Only the action
    /// path can call it: it requires the fee escrow that only MagicBlock's delegation program
    /// can sign for.
    pub fn settle_on_commit(ctx: Context<SettleOnCommit>) -> Result<()> {
        let a = ctx.accounts;
        pay_bidder(&a.yard, &a.unit, &mut a.bidder_record, a.bidder_token_account.to_account_info(), a.vault.to_account_info(), a.token_program.key())
    }

    /// Move one lot of the contents from the warehouse to the winner. Anyone can run it.
    pub fn claim_lot<'info>(ctx: Context<'info, ClaimLot<'info>>, lot_index: u8) -> Result<()> {
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

        // This lot's share of the winning bid leaves the vault now that the lot is delivered, and
        // not before. Shares go by appraised value; the last lot takes the rounding remainder, so
        // the shares always add up to the winning bid whatever order the lots are claimed in.
        let unit = &ctx.accounts.unit;
        let worth = |l: &Lot| -> u128 {
            unit.catalog.get(l.item as usize).map(|f| f.value as u128 * l.qty as u128).unwrap_or(0)
        };
        let total: u128 = unit.lots.iter().map(worth).sum();
        let bid = unit.winning_bid as u128;
        let cut = |l: &Lot| -> u128 { if total == 0 { 0 } else { bid * worth(l) / total } };
        let last = unit.lots.len() - 1;
        let share = if i == last {
            bid.saturating_sub(unit.lots[..last].iter().map(cut).sum::<u128>())
        } else {
            cut(&lot)
        } as u64;

        // Consigned items sell before the yard's own stock, so the operator cannot keep a sale
        // for itself while a player's item waits.
        let qty = lot.qty as u64;
        // Every waiting player item of this kind is used before the yard's own stock, up to the
        // size of the lot. One consignment can be named; more follow as (consignment, payout)
        // pairs in `remaining_accounts`, so a lot can be filled by several players at once.
        let need = qty.min(ctx.accounts.pool.consigned);
        let mut used = 0u64;
        let mut to_seller = 0u64;
        if need > 0 {
            let token_program = ctx.accounts.token_program.key();
            let vault = ctx.accounts.vault.to_account_info();
            let yard_info = ctx.accounts.yard.to_account_info();
            let pay = |to: AccountInfo<'info>, amount: u64| -> Result<()> {
                token::transfer(
                    CpiContext::new_with_signer(
                        token_program,
                        SplTransfer { from: vault.clone(), to, authority: yard_info.clone() },
                        &[seeds],
                    ),
                    amount,
                )
            };
            let mut first: Option<Pubkey> = None;
            if let Some(c) = ctx.accounts.consignment.as_mut() {
                first = Some(c.key());
                let take = qty.min(c.qty);
                let cut = (share as u128 * take as u128 / qty as u128) as u64;
                c.qty -= take;
                c.sold = c.sold.checked_add(take).ok_or(LockupError::Overflow)?;
                c.earned = c.earned.checked_add(cut).ok_or(LockupError::Overflow)?;
                if cut > 0 {
                    let payout = ctx.accounts.seller_payout.as_ref().ok_or(LockupError::InvalidAccount)?;
                    require_keys_eq!(payout.owner, c.seller, LockupError::Unauthorized);
                    pay(payout.to_account_info(), cut)?;
                }
                used += take;
                to_seller += cut;
            }
            let yard_key = ctx.accounts.yard.key();
            let mint_key = ctx.accounts.item_mint.key();
            let bid_mint = ctx.accounts.yard.bid_mint;
            let mut previous: Option<Pubkey> = None;
            for pair in ctx.remaining_accounts.chunks(2) {
                require!(pair.len() == 2, LockupError::InvalidAccount);
                let key = pair[0].key();
                // Each consignment once: not the named one, and in rising key order.
                require!(Some(key) != first, LockupError::InvalidAccount);
                require!(previous.map_or(true, |p| key > p), LockupError::InvalidAccount);
                previous = Some(key);
                let mut c: Account<Consignment> = Account::try_from(&pair[0])?;
                let expected = Pubkey::create_program_address(
                    &[CONSIGN_SEED, yard_key.as_ref(), c.seller.as_ref(), mint_key.as_ref(), &[c.bump]],
                    ctx.program_id,
                )
                .map_err(|_| error!(LockupError::InvalidAccount))?;
                require_keys_eq!(key, expected, LockupError::InvalidAccount);
                let payout: Account<TokenAccount> = Account::try_from(&pair[1])?;
                require_keys_eq!(payout.mint, bid_mint, LockupError::MintMismatch);
                require_keys_eq!(payout.owner, c.seller, LockupError::Unauthorized);
                let take = (qty - used).min(c.qty);
                let cut = (share as u128 * take as u128 / qty as u128) as u64;
                c.qty -= take;
                c.sold = c.sold.checked_add(take).ok_or(LockupError::Overflow)?;
                c.earned = c.earned.checked_add(cut).ok_or(LockupError::Overflow)?;
                if cut > 0 {
                    pay(pair[1].clone(), cut)?;
                }
                c.exit(ctx.program_id)?;
                used += take;
                to_seller += cut;
            }
            // The operator cannot keep any part of a sale for itself while a player's item waits.
            require!(used == need, LockupError::ConsignedFirst);
        }
        let to_house = share - to_seller;
        if to_house > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    SplTransfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                        authority: ctx.accounts.yard.to_account_info(),
                    },
                    &[seeds],
                ),
                to_house,
            )?;
        }

        let pool = &mut ctx.accounts.pool;
        pool.consigned -= used;
        pool.auction_sold = pool.auction_sold.checked_add(qty).ok_or(LockupError::Overflow)?;
        pool.auction_paid = pool.auction_paid.checked_add(share).ok_or(LockupError::Overflow)?;
        pool.auction_last = share / qty;
        // What is left in the warehouse must still cover every item players have waiting.
        ctx.accounts.warehouse.reload()?;
        require!(ctx.accounts.warehouse.amount >= pool.consigned, LockupError::NotEnoughConsigned);

        let all = ((1u16 << ctx.accounts.unit.lots.len()) - 1) as u8;
        if ctx.accounts.unit.claimed_mask & all == all {
            ctx.accounts.unit.claimed_mask |= BID_PAID;
        }
        Ok(())
    }

    /// Escape hatch: take the whole deposit back from a unit that has stalled.
    ///
    /// While the line is still open, an hour after joining: the bidder also leaves the line, so
    /// the deposit they took back can no longer back a bid. Once the unit is locked, an hour
    /// after its clock ran out with no result on Solana; by then bidding is over. Works while the
    /// unit is still held by the rollup.
    pub fn reclaim_stalled(ctx: Context<ReclaimStalled>) -> Result<()> {
        let record = &ctx.accounts.bidder_record;
        require!(!record.settled, LockupError::AlreadySettled);
        let now = Clock::get()?.unix_timestamp;
        let who = ctx.accounts.bidder.key();

        let unit_info = ctx.accounts.unit.to_account_info();
        // A delegated unit is owned by the delegation program; its data on Solana is the state it
        // left with, which is all that is needed here: its status and when its clock ends.
        let mut unit: Unit = read_account(&unit_info)?;
        match unit.status {
            // A unit back on Solana with a result must be settled the normal way.
            UnitStatus::Closed => return err!(LockupError::WrongStatus),
            UnitStatus::Bidding => {
                require!(now >= unit.closes_at.saturating_add(RECLAIM_SECONDS), LockupError::TooEarly);
            }
            UnitStatus::Created | UnitStatus::Open => {
                require!(now >= record.joined_at.saturating_add(RECLAIM_SECONDS), LockupError::TooEarly);
                require!(*unit_info.owner == crate::ID, LockupError::WrongStatus);
                unit.slots.retain(|s| s.bidder != who);
                // The account keeps its size; the tail left by the shorter list is zeroed.
                let mut data = unit_info.try_borrow_mut_data()?;
                data.fill(0);
                unit.try_serialize(&mut &mut data[..])?;
            }
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

    // ----------------------------------------------------------- Solana: resale

    /// Put items you hold up for sale at a fixed price each. They move into a stall owned by
    /// the yard and stay there until bought or taken back.
    pub fn list_item(ctx: Context<ListItem>, price: u64, qty: u64) -> Result<()> {
        require!(price > 0 && qty > 0, LockupError::BadListing);
        let mint = ctx.accounts.item_mint.key();
        require!(ctx.accounts.yard.catalog.iter().any(|i| i.mint == mint), LockupError::NotInCatalog);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.seller_item_account.to_account_info(),
                    to: ctx.accounts.stall.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            qty,
        )?;
        let listing = &mut ctx.accounts.listing;
        listing.yard = ctx.accounts.yard.key();
        listing.seller = ctx.accounts.seller.key();
        listing.mint = mint;
        listing.price = price;
        listing.qty = qty;
        listing.bump = ctx.bumps.listing;
        Ok(())
    }

    /// Buy `qty` items from a listing. The buyer pays the seller directly; the items leave the
    /// stall in the same instruction. `max_price` guards against a relist at a higher price.
    pub fn buy_item(ctx: Context<BuyItem>, qty: u64, max_price: u64) -> Result<()> {
        let listing = &ctx.accounts.listing;
        require!(qty > 0 && qty <= listing.qty, LockupError::NotEnoughListed);
        require!(listing.price <= max_price, LockupError::PriceChanged);
        let cost = listing.price.checked_mul(qty).ok_or(LockupError::Overflow)?;
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.buyer_token_account.to_account_info(),
                    to: ctx.accounts.seller_token_account.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            cost,
        )?;
        let id = ctx.accounts.yard.yard_id.to_le_bytes();
        let bump = [ctx.accounts.yard.bump];
        let seeds: &[&[u8]] = &[YARD_SEED, &id, &bump];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.stall.to_account_info(),
                    to: ctx.accounts.buyer_item_account.to_account_info(),
                    authority: ctx.accounts.yard.to_account_info(),
                },
                &[seeds],
            ),
            qty,
        )?;
        let pool = &mut ctx.accounts.pool;
        pool.market_sold = pool.market_sold.checked_add(qty).ok_or(LockupError::Overflow)?;
        pool.market_paid = pool.market_paid.checked_add(cost).ok_or(LockupError::Overflow)?;
        pool.market_last = ctx.accounts.listing.price;
        ctx.accounts.listing.qty -= qty;
        if ctx.accounts.listing.qty == 0 {
            // Anyone can send extra tokens to a stall. A token account with a balance cannot be
            // closed, so whatever is left over goes to the last buyer rather than jamming the sale.
            ctx.accounts.stall.reload()?;
            let extra = ctx.accounts.stall.amount;
            if extra > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.key(),
                        SplTransfer {
                            from: ctx.accounts.stall.to_account_info(),
                            to: ctx.accounts.buyer_item_account.to_account_info(),
                            authority: ctx.accounts.yard.to_account_info(),
                        },
                        &[seeds],
                    ),
                    extra,
                )?;
            }
            // Sold out: close the stall and the listing, and return both rents to the seller.
            token::close_account(CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                CloseAccount {
                    account: ctx.accounts.stall.to_account_info(),
                    destination: ctx.accounts.seller.to_account_info(),
                    authority: ctx.accounts.yard.to_account_info(),
                },
                &[seeds],
            ))?;
            ctx.accounts.listing.close(ctx.accounts.seller.to_account_info())?;
        }
        Ok(())
    }

    /// Take unsold items back and close the listing.
    pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
        let id = ctx.accounts.yard.yard_id.to_le_bytes();
        let bump = [ctx.accounts.yard.bump];
        let seeds: &[&[u8]] = &[YARD_SEED, &id, &bump];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.stall.to_account_info(),
                    to: ctx.accounts.seller_item_account.to_account_info(),
                    authority: ctx.accounts.yard.to_account_info(),
                },
                &[seeds],
            ),
            // Everything in the stall, not just what was listed: a stranger's stray token must not
            // be able to stop the seller closing it.
            ctx.accounts.stall.amount,
        )?;
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            CloseAccount {
                account: ctx.accounts.stall.to_account_info(),
                destination: ctx.accounts.seller.to_account_info(),
                authority: ctx.accounts.yard.to_account_info(),
            },
            &[seeds],
        ))?;
        Ok(())
    }

    // ----------------------------------------------------------- Solana: the seller pool

    /// Open the shelf for one item type: its consignment count and price record. Anyone can pay for it.
    pub fn init_pool(ctx: Context<InitPool>) -> Result<()> {
        let mint = ctx.accounts.item_mint.key();
        require!(ctx.accounts.yard.catalog.iter().any(|i| i.mint == mint), LockupError::NotInCatalog);
        let pool = &mut ctx.accounts.pool;
        pool.yard = ctx.accounts.yard.key();
        pool.mint = mint;
        pool.bump = ctx.bumps.pool;
        Ok(())
    }

    /// Hand items you hold to the yard to be sold inside units. They go into the warehouse that
    /// units are stocked from; the random draw decides which unit they come out of. When they
    /// do, `claim_lot` pays you their share of the winning bid.
    pub fn consign(ctx: Context<Consign>, qty: u64) -> Result<()> {
        require!(qty > 0, LockupError::BadListing);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.seller_item_account.to_account_info(),
                    to: ctx.accounts.warehouse.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            qty,
        )?;
        let c = &mut ctx.accounts.consignment;
        c.yard = ctx.accounts.yard.key();
        c.seller = ctx.accounts.seller.key();
        c.mint = ctx.accounts.item_mint.key();
        c.qty = c.qty.checked_add(qty).ok_or(LockupError::Overflow)?;
        c.bump = ctx.bumps.consignment;
        let pool = &mut ctx.accounts.pool;
        pool.consigned = pool.consigned.checked_add(qty).ok_or(LockupError::Overflow)?;
        Ok(())
    }

    /// Take back consigned items that have not been sold yet.
    pub fn withdraw_consignment(ctx: Context<WithdrawConsignment>, qty: u64) -> Result<()> {
        require!(qty > 0 && qty <= ctx.accounts.consignment.qty, LockupError::NotEnoughConsigned);
        let id = ctx.accounts.yard.yard_id.to_le_bytes();
        let bump = [ctx.accounts.yard.bump];
        let seeds: &[&[u8]] = &[YARD_SEED, &id, &bump];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.warehouse.to_account_info(),
                    to: ctx.accounts.seller_item_account.to_account_info(),
                    authority: ctx.accounts.yard.to_account_info(),
                },
                &[seeds],
            ),
            qty,
        )?;
        ctx.accounts.consignment.qty -= qty;
        ctx.accounts.pool.consigned -= qty;
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
    /// The bid currency. Any SPL mint works (the live yard uses Circle's devnet USDC). The
    /// `faucet` instruction only works for a mint whose authority is the yard PDA.
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
    #[account(mut, seeds = [UNIT_SEED, unit.yard.as_ref(), &unit.unit_id.to_le_bytes()], bump = unit.bump, has_one = authority @ LockupError::Unauthorized)]
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

#[commit]
#[derive(Accounts)]
pub struct CommitAndSettle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub authority: Signer<'info>,
    /// CHECK: validated by hand in the handler; see `commit_unit`.
    #[account(mut)]
    pub unit: UncheckedAccount<'info>,
    /// CHECK: only its address is used, and it must be the unit's yard.
    pub yard: UncheckedAccount<'info>,
    /// CHECK: only its address is used; the payout on Solana checks it again.
    #[account(seeds = [VAULT_SEED, yard.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[action]
#[derive(Accounts)]
pub struct SettleOnCommit<'info> {
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
    /// CHECK: the program that scheduled the action. MagicBlock passes it before the escrow accounts.
    #[account(address = crate::ID)]
    pub source_program: UncheckedAccount<'info>,
    /// CHECK: whoever's escrow pays for the action. The payout is the same whoever that is.
    pub escrow_auth: UncheckedAccount<'info>,
    /// CHECK: MagicBlock's fee escrow. Only its delegation program can sign for it, which limits
    /// this instruction to the Magic Action path.
    #[account(signer, address = ephemeral_rollups_sdk::pda::ephemeral_balance_pda_from_payer(&escrow_auth.key(), ACTION_ESCROW_INDEX))]
    pub escrow: UncheckedAccount<'info>,
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
    #[account(mut, seeds = [VAULT_SEED, yard.key().as_ref()], bump, constraint = vault.key() == yard.vault @ LockupError::InvalidAccount)]
    pub vault: Box<Account<'info, TokenAccount>>,
    /// Where the yard's share of the winning bid is paid. Must belong to the yard's operator.
    #[account(mut, constraint = treasury.owner == yard.authority @ LockupError::Unauthorized, constraint = treasury.mint == yard.bid_mint @ LockupError::MintMismatch)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [POOL_SEED, yard.key().as_ref(), item_mint.key().as_ref()], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,
    /// A player's waiting items of this kind. Required whenever the pool has any.
    #[account(mut, seeds = [CONSIGN_SEED, yard.key().as_ref(), consignment.seller.as_ref(), item_mint.key().as_ref()], bump = consignment.bump)]
    pub consignment: Option<Box<Account<'info, Consignment>>>,
    /// The consigning player's account for the bid currency. Its owner is checked against the consignment.
    #[account(mut, constraint = seller_payout.mint == yard.bid_mint @ LockupError::MintMismatch)]
    pub seller_payout: Option<Box<Account<'info, TokenAccount>>>,
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
    #[account(mut, address = bidder_record.unit @ LockupError::InvalidAccount)]
    pub unit: UncheckedAccount<'info>,
    #[account(mut, seeds = [BIDDER_SEED, unit.key().as_ref(), bidder.key().as_ref()], bump = bidder_record.bump, constraint = bidder_record.bidder == bidder.key() @ LockupError::Unauthorized, constraint = bidder_record.yard == yard.key() @ LockupError::InvalidAccount)]
    pub bidder_record: Box<Account<'info, Bidder>>,
    #[account(mut, constraint = bidder_token_account.owner == bidder.key() @ LockupError::Unauthorized, constraint = bidder_token_account.mint == yard.bid_mint @ LockupError::MintMismatch)]
    pub bidder_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [VAULT_SEED, yard.key().as_ref()], bump, constraint = vault.key() == yard.vault @ LockupError::InvalidAccount)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ListItem<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(seeds = [YARD_SEED, &yard.yard_id.to_le_bytes()], bump = yard.bump)]
    pub yard: Box<Account<'info, Yard>>,
    pub item_mint: Box<Account<'info, Mint>>,
    #[account(mut, constraint = seller_item_account.owner == seller.key() @ LockupError::Unauthorized, constraint = seller_item_account.mint == item_mint.key() @ LockupError::MintMismatch)]
    pub seller_item_account: Box<Account<'info, TokenAccount>>,
    /// One listing per seller per item. Cancel it to change the price.
    #[account(init, payer = seller, space = 8 + Listing::INIT_SPACE, seeds = [LISTING_SEED, yard.key().as_ref(), seller.key().as_ref(), item_mint.key().as_ref()], bump)]
    pub listing: Box<Account<'info, Listing>>,
    #[account(init, payer = seller, token::mint = item_mint, token::authority = yard, seeds = [STALL_SEED, listing.key().as_ref()], bump)]
    pub stall: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyItem<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [YARD_SEED, &yard.yard_id.to_le_bytes()], bump = yard.bump)]
    pub yard: Box<Account<'info, Yard>>,
    #[account(mut, seeds = [LISTING_SEED, yard.key().as_ref(), listing.seller.as_ref(), listing.mint.as_ref()], bump = listing.bump)]
    pub listing: Box<Account<'info, Listing>>,
    /// CHECK: only receives rent when the listing sells out. Tied to the listing by address.
    #[account(mut, address = listing.seller @ LockupError::InvalidAccount)]
    pub seller: UncheckedAccount<'info>,
    #[account(mut, seeds = [STALL_SEED, listing.key().as_ref()], bump)]
    pub stall: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = buyer_token_account.owner == buyer.key() @ LockupError::Unauthorized, constraint = buyer_token_account.mint == yard.bid_mint @ LockupError::MintMismatch)]
    pub buyer_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = seller_token_account.owner == listing.seller @ LockupError::Unauthorized, constraint = seller_token_account.mint == yard.bid_mint @ LockupError::MintMismatch)]
    pub seller_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = buyer_item_account.owner == buyer.key() @ LockupError::Unauthorized, constraint = buyer_item_account.mint == listing.mint @ LockupError::MintMismatch)]
    pub buyer_item_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [POOL_SEED, yard.key().as_ref(), listing.mint.as_ref()], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelListing<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(seeds = [YARD_SEED, &yard.yard_id.to_le_bytes()], bump = yard.bump)]
    pub yard: Box<Account<'info, Yard>>,
    #[account(mut, close = seller, has_one = seller @ LockupError::Unauthorized, seeds = [LISTING_SEED, yard.key().as_ref(), seller.key().as_ref(), listing.mint.as_ref()], bump = listing.bump)]
    pub listing: Box<Account<'info, Listing>>,
    #[account(mut, seeds = [STALL_SEED, listing.key().as_ref()], bump)]
    pub stall: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = seller_item_account.owner == seller.key() @ LockupError::Unauthorized, constraint = seller_item_account.mint == listing.mint @ LockupError::MintMismatch)]
    pub seller_item_account: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct InitPool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [YARD_SEED, &yard.yard_id.to_le_bytes()], bump = yard.bump)]
    pub yard: Box<Account<'info, Yard>>,
    pub item_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = payer, space = 8 + Pool::INIT_SPACE, seeds = [POOL_SEED, yard.key().as_ref(), item_mint.key().as_ref()], bump)]
    pub pool: Box<Account<'info, Pool>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Consign<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(seeds = [YARD_SEED, &yard.yard_id.to_le_bytes()], bump = yard.bump)]
    pub yard: Box<Account<'info, Yard>>,
    pub item_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [POOL_SEED, yard.key().as_ref(), item_mint.key().as_ref()], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,
    /// One per seller per item. Consigning again adds to it.
    #[account(init_if_needed, payer = seller, space = 8 + Consignment::INIT_SPACE, seeds = [CONSIGN_SEED, yard.key().as_ref(), seller.key().as_ref(), item_mint.key().as_ref()], bump)]
    pub consignment: Box<Account<'info, Consignment>>,
    #[account(mut, constraint = seller_item_account.owner == seller.key() @ LockupError::Unauthorized, constraint = seller_item_account.mint == item_mint.key() @ LockupError::MintMismatch)]
    pub seller_item_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [WAREHOUSE_SEED, yard.key().as_ref(), item_mint.key().as_ref()], bump)]
    pub warehouse: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawConsignment<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(seeds = [YARD_SEED, &yard.yard_id.to_le_bytes()], bump = yard.bump)]
    pub yard: Box<Account<'info, Yard>>,
    #[account(mut, seeds = [POOL_SEED, yard.key().as_ref(), consignment.mint.as_ref()], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(mut, has_one = seller @ LockupError::Unauthorized, seeds = [CONSIGN_SEED, yard.key().as_ref(), seller.key().as_ref(), consignment.mint.as_ref()], bump = consignment.bump)]
    pub consignment: Box<Account<'info, Consignment>>,
    #[account(mut, constraint = seller_item_account.owner == seller.key() @ LockupError::Unauthorized, constraint = seller_item_account.mint == consignment.mint @ LockupError::MintMismatch)]
    pub seller_item_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [WAREHOUSE_SEED, yard.key().as_ref(), consignment.mint.as_ref()], bump)]
    pub warehouse: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}
