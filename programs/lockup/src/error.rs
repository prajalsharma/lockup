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
}
