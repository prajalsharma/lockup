//! Pure game rules. No Solana types, so this is unit-tested with plain `cargo test`.
//!
//! Two jobs: turn a 32-byte seed into a unit's contents and its three clues, and pick the
//! winning bid.

pub const MAX_ITEMS: usize = 12;
pub const MAX_LOTS: usize = 6;
pub const MAX_BIDDERS: usize = 8;

pub const RARITY_COMMON: u8 = 0;
pub const RARITY_RARE: u8 = 1;
pub const RARITY_GRAIL: u8 = 2;

pub const CLUE_COUNT: u8 = 0;
pub const CLUE_GROUP: u8 = 1;
pub const CLUE_FLOOR: u8 = 2;
pub const CLUE_GRAIL: u8 = 3;
pub const CLUE_HEAVY: u8 = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ItemInfo {
    /// Appraised value in cents of the bid currency.
    pub value: u32,
    pub weight: u16,
    pub rarity: u8,
    pub group: u8,
    pub heavy: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct EngineLot {
    pub item: u8,
    pub qty: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct EngineClue {
    pub kind: u8,
    pub arg: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Stocked {
    pub lots: Vec<EngineLot>,
    pub value: u32,
    pub clues: [EngineClue; 3],
}

#[derive(Debug, PartialEq, Eq)]
pub enum EngineError {
    EmptyCatalog,
    Overflow,
}

/// splitmix64 over the seed. Deterministic and cheap; the unpredictability comes from the seed.
struct Rng(u64);

impl Rng {
    fn new(seed: &[u8; 32]) -> Self {
        let mut s = 0u64;
        for chunk in seed.chunks(8) {
            let mut b = [0u8; 8];
            b.copy_from_slice(chunk);
            s = s.rotate_left(17) ^ u64::from_le_bytes(b);
        }
        Rng(s)
    }
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        if n == 0 { 0 } else { self.next() % n }
    }
}

/// Draw a unit's contents and clues from a seed.
pub fn stock(seed: &[u8; 32], catalog: &[ItemInfo]) -> Result<Stocked, EngineError> {
    let total: u64 = catalog.iter().map(|c| c.weight as u64).sum();
    if catalog.is_empty() || total == 0 {
        return Err(EngineError::EmptyCatalog);
    }
    let mut rng = Rng::new(seed);

    // 3 to 6 draws; repeats merge into one lot, so there are never more than MAX_LOTS lots.
    let draws = 3 + rng.below(4) as usize;
    let mut lots: Vec<EngineLot> = Vec::with_capacity(MAX_LOTS);
    for _ in 0..draws {
        let mut x = rng.below(total);
        let mut pick = 0usize;
        for (i, c) in catalog.iter().enumerate() {
            if x < c.weight as u64 {
                pick = i;
                break;
            }
            x -= c.weight as u64;
        }
        match lots.iter_mut().find(|l| l.item as usize == pick) {
            Some(l) => l.qty = l.qty.checked_add(1).ok_or(EngineError::Overflow)?,
            None => lots.push(EngineLot { item: pick as u8, qty: 1 }),
        }
    }
    lots.sort_by(|a, b| catalog[b.item as usize].value.cmp(&catalog[a.item as usize].value));

    let mut value = 0u32;
    let mut count = 0u32;
    let mut heavy = 0u32;
    let mut grail = false;
    let mut groups: Vec<u8> = Vec::new();
    for l in &lots {
        let c = &catalog[l.item as usize];
        value = value
            .checked_add(c.value.checked_mul(l.qty as u32).ok_or(EngineError::Overflow)?)
            .ok_or(EngineError::Overflow)?;
        count += l.qty as u32;
        if c.heavy {
            heavy += l.qty as u32;
        }
        if c.rarity == RARITY_GRAIL {
            grail = true;
        }
        if !groups.contains(&c.group) {
            groups.push(c.group);
        }
    }

    // Every true statement about the unit. The draw decides which three go on the door.
    let mut pool: Vec<EngineClue> = Vec::with_capacity(4 + groups.len());
    pool.push(EngineClue { kind: CLUE_COUNT, arg: count });
    for g in groups {
        pool.push(EngineClue { kind: CLUE_GROUP, arg: g as u32 });
    }
    // A floor between 35% and 60% of the true value, rounded down to 5 cents, never below 5.
    let pct = 35 + rng.below(26) as u32;
    let floor = ((value * pct / 100) / 5 * 5).max(5);
    pool.push(EngineClue { kind: CLUE_FLOOR, arg: floor });
    pool.push(EngineClue { kind: CLUE_GRAIL, arg: grail as u32 });
    pool.push(EngineClue { kind: CLUE_HEAVY, arg: heavy });
    for i in (1..pool.len()).rev() {
        let j = rng.below(i as u64 + 1) as usize;
        pool.swap(i, j);
    }
    Ok(Stocked { lots, value, clues: [pool[0], pool[1], pool[2]] })
}

/// Highest bid wins. A tie goes to the bid placed first (lower `order`).
/// Input is `(amount, order)` per bid; returns the index of the winner in that slice.
pub fn pick_winner(bids: &[(u64, u8)]) -> Option<usize> {
    let mut best: Option<usize> = None;
    for (i, (amount, order)) in bids.iter().enumerate() {
        match best {
            None => best = Some(i),
            Some(b) => {
                let (ba, bo) = bids[b];
                if *amount > ba || (*amount == ba && *order < bo) {
                    best = Some(i);
                }
            }
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog() -> Vec<ItemInfo> {
        let mut c = Vec::new();
        for (value, rarity, group, heavy) in [
            (4, 0, 0, false), (12, 0, 0, true), (18, 0, 1, false), (26, 0, 1, true),
            (30, 0, 2, false), (22, 0, 2, false), (55, 1, 5, false), (70, 1, 2, false),
            (95, 1, 1, false), (120, 1, 3, true), (240, 2, 3, true), (400, 2, 4, true),
        ] {
            let weight = match rarity { 0 => 50, 1 => 15, _ => 3 };
            c.push(ItemInfo { value, weight, rarity, group, heavy });
        }
        c
    }

    fn seed(n: u8) -> [u8; 32] {
        let mut s = [0u8; 32];
        for (i, b) in s.iter_mut().enumerate() { *b = n.wrapping_mul(31).wrapping_add(i as u8 * 7); }
        s
    }

    #[test]
    fn same_seed_same_unit() {
        let c = catalog();
        assert_eq!(stock(&seed(1), &c).unwrap(), stock(&seed(1), &c).unwrap());
    }

    #[test]
    fn different_seeds_differ() {
        let c = catalog();
        let all: Vec<_> = (0..40u8).map(|n| stock(&seed(n), &c).unwrap().lots).collect();
        assert!(all.iter().any(|l| *l != all[0]));
    }

    #[test]
    fn contents_are_bounded_and_value_adds_up() {
        let c = catalog();
        for n in 0..=255u8 {
            let s = stock(&seed(n), &c).unwrap();
            let count: u32 = s.lots.iter().map(|l| l.qty as u32).sum();
            assert!((3..=6).contains(&count));
            assert!(s.lots.len() <= MAX_LOTS);
            let v: u32 = s.lots.iter().map(|l| c[l.item as usize].value * l.qty as u32).sum();
            assert_eq!(v, s.value);
            // no item appears in two lots
            for (i, a) in s.lots.iter().enumerate() {
                assert!(s.lots.iter().skip(i + 1).all(|b| b.item != a.item));
            }
        }
    }

    #[test]
    fn every_clue_is_true() {
        let c = catalog();
        for n in 0..=255u8 {
            let s = stock(&seed(n), &c).unwrap();
            for clue in s.clues {
                match clue.kind {
                    CLUE_COUNT => assert_eq!(clue.arg, s.lots.iter().map(|l| l.qty as u32).sum::<u32>()),
                    CLUE_GROUP => assert!(s.lots.iter().any(|l| c[l.item as usize].group as u32 == clue.arg)),
                    CLUE_FLOOR => assert!(clue.arg <= s.value.max(5) && clue.arg >= 5),
                    CLUE_GRAIL => assert_eq!(clue.arg == 1, s.lots.iter().any(|l| c[l.item as usize].rarity == RARITY_GRAIL)),
                    CLUE_HEAVY => assert_eq!(clue.arg, s.lots.iter().filter(|l| c[l.item as usize].heavy).map(|l| l.qty as u32).sum::<u32>()),
                    _ => panic!("unknown clue"),
                }
            }
        }
    }

    #[test]
    fn empty_catalog_is_rejected() {
        assert_eq!(stock(&seed(1), &[]), Err(EngineError::EmptyCatalog));
    }

    #[test]
    fn highest_bid_wins() {
        assert_eq!(pick_winner(&[(50, 0), (90, 1), (70, 2)]), Some(1));
    }

    #[test]
    fn tie_goes_to_the_earlier_bid() {
        assert_eq!(pick_winner(&[(90, 2), (90, 0), (90, 1)]), Some(1));
    }

    #[test]
    fn no_bids_no_winner() {
        assert_eq!(pick_winner(&[]), None);
    }
}
