// =============================================================================
// VULTR - Solana Liquidation Pool Protocol
// =============================================================================
//
// "Circle. Wait. Feast." 🦅
//
// VULTR is a decentralized liquidation pool on Solana where:
// - Users deposit USDC and receive sVLTR shares
// - Team's bot executes liquidations on lending protocols
// - Profits are distributed: 80% depositors, 15% VLTR stakers, 5% treasury
//
// This is the main entry point for the VULTR Anchor program.
// =============================================================================

// Module declarations - these tell Rust where to find our code
pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

// Import everything from Anchor's prelude (common types and macros)
use anchor_lang::prelude::*;

// Re-export our modules so users of this crate can access them
pub use constants::*;
pub use error::*;
pub use instructions::*;
pub use state::*;

// Declare the program ID - this is the address of the deployed program
// Deployed to devnet: 7EhoUeYzjKJB27aoMA4tXoLc9kj6bESVyzwjsN2rUbAe
declare_id!("7EhoUeYzjKJB27aoMA4tXoLc9kj6bESVyzwjsN2rUbAe");

/// The VULTR program module
///
/// This is where we define all the instruction handlers that users can call.
/// Each function here corresponds to an instruction that can be sent to the program.
#[program]
pub mod vultr {
    use super::*;

    // =========================================================================
    // Pool Initialization
    // =========================================================================

    /// Initialize a new VULTR liquidation pool
    ///
    /// Creates:
    /// - Pool account (stores configuration)
    /// - Vault token account (holds deposits)
    /// - Share mint (sVLTR tokens)
    ///
    /// Requires external accounts:
    /// - Treasury token account (for 5% protocol fees)
    /// - Staking rewards vault (for 15% VLTR staker rewards)
    /// - Bot wallet address (authorized to call record_profit)
    ///
    /// Can only be called once per deposit token (e.g., USDC)
    pub fn initialize_pool(ctx: Context<InitializePool>) -> Result<()> {
        instructions::initialize_pool::handler_initialize_pool(ctx)
    }

    // =========================================================================
    // User Operations
    // =========================================================================

    /// Deposit tokens into the pool and receive shares
    ///
    /// # Arguments
    /// * `amount` - Amount of deposit tokens to deposit (in base units)
    /// * `min_shares_out` - Minimum shares to receive (slippage protection, 0 to skip)
    ///
    /// # Returns
    /// * Minted shares based on current share price
    pub fn deposit(ctx: Context<DepositToPool>, amount: u64, min_shares_out: u64) -> Result<()> {
        instructions::deposit::handler_deposit(ctx, amount, min_shares_out)
    }

    /// Withdraw tokens by burning shares
    ///
    /// # Arguments
    /// * `shares_to_burn` - Number of share tokens to burn
    /// * `min_amount_out` - Minimum tokens to receive (slippage protection, 0 to skip)
    ///
    /// # Returns
    /// * Deposit tokens based on current share price (includes profits!)
    pub fn withdraw(ctx: Context<Withdraw>, shares_to_burn: u64, min_amount_out: u64) -> Result<()> {
        instructions::withdraw::handler_withdraw(ctx, shares_to_burn, min_amount_out)
    }

    // =========================================================================
    // Bot Operations (Team's bot only)
    // =========================================================================

    /// Record profit from a liquidation and distribute fees
    ///
    /// This can ONLY be called by the authorized bot_wallet stored in the pool.
    /// The bot performs liquidations off-chain and then calls this to record profit.
    ///
    /// # Arguments
    /// * `profit_amount` - Total profit from liquidation (in deposit token base units)
    ///
    /// # Fee Distribution
    /// * 80% to vault (increases share price for depositors)
    /// * 15% to staking_rewards_vault (for VLTR token stakers)
    /// * 5% to treasury (protocol revenue)
    pub fn record_profit(ctx: Context<RecordProfit>, profit_amount: u64) -> Result<()> {
        instructions::record_profit::handler_record_profit(ctx, profit_amount)
    }

    // =========================================================================
    // Admin Operations
    // =========================================================================

    /// Pause or unpause the pool (admin only)
    ///
    /// # Arguments
    /// * `paused` - true to pause, false to unpause
    ///
    /// When paused:
    /// * No deposits allowed
    /// * No withdrawals allowed
    /// * No profit recording allowed
    pub fn pause_pool(ctx: Context<PausePool>, paused: bool) -> Result<()> {
        instructions::admin::handler_pause_pool(ctx, paused)
    }

    /// Update fee configuration (admin only)
    ///
    /// # Arguments
    /// * `depositor_fee_bps` - Depositor share in basis points (default 8000 = 80%)
    /// * `staking_fee_bps` - VLTR staker share in basis points (default 1500 = 15%)
    /// * `treasury_fee_bps` - Treasury share in basis points (default 500 = 5%)
    ///
    /// # Requirements
    /// * All three must sum to exactly 10000 (100%)
    /// * Depositor share must be at least 50%
    /// * Staking share must be at most 30%
    /// * Treasury share must be at most 20%
    pub fn update_fees(
        ctx: Context<UpdateFees>,
        depositor_fee_bps: u16,
        staking_fee_bps: u16,
        treasury_fee_bps: u16,
    ) -> Result<()> {
        instructions::admin::handler_update_fees(ctx, depositor_fee_bps, staking_fee_bps, treasury_fee_bps)
    }

    /// Update the authorized bot wallet address (admin only)
    ///
    /// # Purpose
    /// Allows admin to change the bot wallet for:
    /// - Key rotation for security
    /// - Upgrading to a new bot
    /// - Switching to a different operator
    ///
    /// # Security
    /// Only the new bot_wallet will be able to call record_profit
    pub fn update_bot_wallet(ctx: Context<UpdateBotWallet>) -> Result<()> {
        instructions::admin::handler_update_bot_wallet(ctx)
    }

    /// Update maximum pool size cap (admin only)
    ///
    /// # Arguments
    /// * `new_cap` - New maximum pool size in base units (e.g., USDC with 6 decimals)
    ///
    /// # Purpose
    /// Allows admin to control pool growth for optimal capital efficiency:
    /// - Start with lower cap (500K USDC) for high APY at launch
    /// - Gradually raise cap as liquidation volume grows
    /// - Ensure pool size matches available liquidation opportunities
    ///
    /// # Constraints
    /// - Cannot exceed global MAX_POOL_SIZE (1B USDC)
    /// - Cannot reduce below current total_deposits
    pub fn update_pool_cap(
        ctx: Context<UpdatePoolCap>,
        new_cap: u64,
    ) -> Result<()> {
        instructions::update_pool_cap::handler_update_pool_cap(ctx, new_cap)
    }

    /// Transfer admin rights to a new address (admin only)
    ///
    /// # Warning
    /// * This is irreversible!
    /// * Make sure the new admin address is correct
    /// * Consider using a multisig
    pub fn transfer_admin(ctx: Context<TransferAdmin>) -> Result<()> {
        instructions::admin::handler_transfer_admin(ctx)
    }
}
