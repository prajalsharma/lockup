use anchor_lang::prelude::*;

use crate::engine::{MAX_BIDDERS, MAX_ITEMS, MAX_LOTS};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum UnitStatus {
    /// Created; waiting for the VRF draw.
    Created,
    /// Draw received. Wallets can line up with a deposit.
    Open,
    /// Line closed, clock running. Bids are placed on the private rollup.
    Bidding,
    /// Bids read, winner and contents written. Final.
    Closed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, Default)]
pub struct Item {
    pub mint: Pubkey,
    /// Appraised value in cents of the bid currency.
    pub value: u32,
    pub weight: u16,
    pub rarity: u8,
    pub group: u8,
    pub heavy: bool,
}

/// The catalog facts the rollup needs to stock a unit. Copied into the unit at creation.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, Default)]
pub struct ItemFacts {
    pub value: u32,
    pub weight: u16,
    pub rarity: u8,
    pub group: u8,
    pub heavy: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, Default)]
pub struct Lot {
    pub item: u8,
    pub qty: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, Default)]
pub struct Clue {
    pub kind: u8,
    pub arg: u32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, Default)]
pub struct Slot {
    pub bidder: Pubkey,
    /// Escrowed on Solana. Public. Caps the bid.
    pub deposit: u64,
    pub has_bid: bool,
    /// The bid amount, but only once the unit is closed. While bidding is open the amount stays
    /// in the sealed `Bid` account, and this field carries what the table is allowed to see of
    /// the bidder: how many times they raised, when they last acted, and whether they locked in.
    /// `close_unit` overwrites it with the amount.
    pub bid: u64,
}

/// What everyone at the table can see of a bidder while bids are sealed. Never an amount.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Tell {
    /// How many times the bidder has raised their sealed bid.
    pub raises: u16,
    /// Locked in: this bidder is done, and cannot raise again.
    pub locked: bool,
    /// Seconds after the bidding clock started at which they last acted.
    pub last_at: u32,
}

impl Slot {
    pub fn tell(&self) -> Tell {
        Tell { raises: self.bid as u16, locked: self.bid & (1 << 16) != 0, last_at: (self.bid >> 32) as u32 }
    }
    pub fn set_tell(&mut self, t: Tell) {
        self.bid = t.raises as u64 | (t.locked as u64) << 16 | (t.last_at as u64) << 32;
    }
}

#[account]
#[derive(InitSpace)]
pub struct Yard {
    pub authority: Pubkey,
    pub yard_id: u64,
    pub bid_mint: Pubkey,
    pub vault: Pubkey,
    pub unit_count: u64,
    #[max_len(MAX_ITEMS)]
    pub catalog: Vec<Item>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Unit {
    pub yard: Pubkey,
    pub unit_id: u64,
    pub authority: Pubkey,
    pub status: UnitStatus,
    pub min_bid: u64,
    pub duration: i64,
    pub closes_at: i64,
    /// sha256(salt). The salt stays with the operator until the unit closes.
    pub salt_commit: [u8; 32],
    /// From MagicBlock VRF. Public, and useless without the salt.
    pub randomness: [u8; 32],
    pub stocked: bool,
    pub clues: [Clue; 3],
    pub bid_count: u8,
    #[max_len(MAX_BIDDERS)]
    pub slots: Vec<Slot>,
    #[max_len(MAX_ITEMS)]
    pub catalog: Vec<ItemFacts>,
    // ---- results, empty until Closed ----
    pub winner: Pubkey,
    pub winning_bid: u64,
    #[max_len(MAX_LOTS)]
    pub lots: Vec<Lot>,
    pub value: u32,
    /// Published at close so anyone can recompute the contents from randomness + salt.
    pub salt: [u8; 32],
    /// Bit i set = lot i has been paid out to the winner.
    pub claimed_mask: u8,
    pub bump: u8,
}

impl Unit {
    pub fn slot_index(&self, bidder: &Pubkey) -> Option<usize> {
        self.slots.iter().position(|s| s.bidder == *bidder)
    }
    /// Seconds since the bidding clock started, for stamping a bidder's last action.
    pub fn seconds_in(&self, now: i64) -> u32 {
        now.saturating_sub(self.closes_at.saturating_sub(self.duration)).clamp(0, u32::MAX as i64) as u32
    }
    /// True once nobody in line can change the outcome: everyone has bid and locked in.
    pub fn everyone_locked(&self) -> bool {
        !self.slots.is_empty() && self.slots.iter().all(|s| s.has_bid && s.tell().locked)
    }
}

/// One wallet's place in line for one unit. Lives on Solana and holds the escrow record.
#[account]
#[derive(InitSpace)]
pub struct Bidder {
    pub yard: Pubkey,
    pub unit: Pubkey,
    pub bidder: Pubkey,
    pub deposit: u64,
    pub joined_at: i64,
    pub settled: bool,
    pub won: bool,
    pub bump: u8,
}

/// A sealed bid. Exists only on the private rollup; only the bidder can read it.
#[account]
#[derive(InitSpace)]
pub struct Bid {
    pub unit: Pubkey,
    pub bidder: Pubkey,
    pub amount: u64,
    pub order: u8,
    pub bump: u8,
}

/// A unit's contents. Exists only on the private rollup until the unit closes.
#[account]
#[derive(InitSpace)]
pub struct Manifest {
    pub unit: Pubkey,
    #[max_len(MAX_LOTS)]
    pub lots: Vec<Lot>,
    pub value: u32,
    pub salt: [u8; 32],
    pub bump: u8,
}

/// Faucet cooldown per wallet.
#[account]
#[derive(InitSpace)]
pub struct Tap {
    pub last: i64,
    pub bump: u8,
}

/// One wallet's offer to sell one kind of item it holds. The items wait in a stall owned by
/// the yard until someone buys them or the seller takes them back.
#[account]
#[derive(InitSpace)]
pub struct Listing {
    pub yard: Pubkey,
    pub seller: Pubkey,
    pub mint: Pubkey,
    /// Price of one item, in the bid currency's smallest unit.
    pub price: u64,
    pub qty: u64,
    pub bump: u8,
}

/// One item type's shelf in the yard: how many consigned items are waiting in the warehouse, and
/// the price record anyone can read. Auction prices are each lot's share of a winning bid;
/// market prices are fixed-price resales.
#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub yard: Pubkey,
    pub mint: Pubkey,
    /// Player-owned items waiting in the warehouse. They are sold before the yard's own stock.
    pub consigned: u64,
    pub auction_sold: u64,
    /// Bid currency paid for those items, in its smallest unit.
    pub auction_paid: u64,
    /// Price of one item in the most recent unit it came out of.
    pub auction_last: u64,
    pub market_sold: u64,
    pub market_paid: u64,
    pub market_last: u64,
    pub bump: u8,
}

/// Items one wallet has handed to the yard to be sold inside units. When one of them comes out
/// of a unit, its share of the winning bid is paid to the seller by the program.
#[account]
#[derive(InitSpace)]
pub struct Consignment {
    pub yard: Pubkey,
    pub seller: Pubkey,
    pub mint: Pubkey,
    /// Still waiting to be sold. Can be taken back at any time.
    pub qty: u64,
    pub sold: u64,
    pub earned: u64,
    pub bump: u8,
}
