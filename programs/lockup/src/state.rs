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
    /// Zero until the unit is closed.
    pub bid: u64,
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
