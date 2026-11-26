use anchor_lang::prelude::*;

#[error_code]
pub enum LockupError {
    #[msg("Only the yard authority can do this")]
    Unauthorized,
    #[msg("The catalog is full")]
    CatalogFull,
    #[msg("Bad item settings")]
    InvalidItem,
    #[msg("Duration is out of range")]
    InvalidDuration,
    #[msg("Minimum bid must be above zero")]
    InvalidMinBid,
    #[msg("The unit is not in the right state for this")]
    WrongStatus,
    #[msg("The unit is full")]
    UnitFull,
    #[msg("This wallet already joined the unit")]
    AlreadyJoined,
    #[msg("Deposit is below the minimum bid")]
    DepositTooSmall,
    #[msg("This wallet is not in line for the unit")]
    NotInLine,
    #[msg("Bid is below the minimum")]
    BidTooLow,
    #[msg("Bid is above your deposit")]
    BidAboveDeposit,
    #[msg("This wallet already bid")]
    AlreadyBid,
    #[msg("Bidding has closed")]
    BiddingClosed,
    #[msg("Bidding is still open")]
    BiddingStillOpen,
    #[msg("The unit has not been stocked yet")]
    NotStocked,
    #[msg("The unit is already stocked")]
    AlreadyStocked,
    #[msg("Salt does not match the commitment")]
    BadSalt,
    #[msg("Wrong account passed in")]
    InvalidAccount,
    #[msg("Wrong number of bid accounts")]
    BidCountMismatch,
    #[msg("The same bid account was passed twice")]
    DuplicateBid,
    #[msg("Already settled")]
    AlreadySettled,
    #[msg("Not the winner")]
    NotWinner,
    #[msg("That lot was already claimed")]
    AlreadyClaimed,
    #[msg("Too early to reclaim")]
    TooEarly,
    #[msg("Token mint does not match")]
    MintMismatch,
    #[msg("Faucet was used recently")]
    FaucetCooldown,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Stocking failed")]
    StockFailed,
    #[msg("That item is not in this yard's catalog")]
    NotInCatalog,
    #[msg("Price and quantity must be above zero")]
    BadListing,
    #[msg("Not that many left in the listing")]
    NotEnoughListed,
    #[msg("The price is higher than you agreed to")]
    PriceChanged,
    #[msg("This unit already has its draw")]
    AlreadyDrawn,
    #[msg("This unit's draw has not arrived yet")]
    NotDrawn,
    #[msg("Consigned items of this kind are waiting and sell first")]
    ConsignedFirst,
    #[msg("You don't have that many consigned")]
    NotEnoughConsigned,
    #[msg("A raise has to be higher than your current bid")]
    RaiseTooLow,
    #[msg("You locked in, so this bid can't change")]
    LockedIn,
    #[msg("Place a bid before you raise or lock in")]
    NoBidYet,
}
