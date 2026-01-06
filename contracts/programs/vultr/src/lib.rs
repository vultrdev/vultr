// =============================================================================
// VULTR - Solana Liquidation Pool Protocol
// =============================================================================
//
// "Circle. Wait. Feast." 🦅
//
// VULTR is a decentralized liquidation pool on Solana where:
// - Users deposit USDC and receive VLTR shares
// - Operators execute liquidations on lending protocols
// - Profits are distributed: 80% depositors, 15% operators, 5% protocol
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
// When you run `anchor build`, a new keypair is generated if one doesn't exist
// You can find/update this in Anchor.toml
declare_id!("2cTDHuGALYQQQTLai9HLwsvkS7nv6r8JJLgPeMrsRPxm");

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
    /// - Share mint (VLTR tokens)
    /// - Protocol fee vault
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
    ///
    /// # Returns
    /// * Minted shares based on current share price
    pub fn deposit(ctx: Context<DepositToPool>, amount: u64) -> Result<()> {
        instructions::deposit::handler_deposit(ctx, amount)
    }

    /// Withdraw tokens by burning shares
    ///
    /// # Arguments
    /// * `shares_to_burn` - Number of share tokens to burn
    ///
    /// # Returns
    /// * Deposit tokens based on current share price (includes profits!)
    pub fn withdraw(ctx: Context<Withdraw>, shares_to_burn: u64) -> Result<()> {
        instructions::withdraw::handler_withdraw(ctx, shares_to_burn)
    }

    // =========================================================================
    // Operator Operations
    // =========================================================================

    /// Register as a liquidation operator by staking tokens
    ///
    /// # Arguments
    /// * `stake_amount` - Amount to stake (must be >= MIN_OPERATOR_STAKE)
    ///
    /// # Requirements
    /// * Must stake at least 10,000 USDC equivalent
    pub fn register_operator(ctx: Context<RegisterOperator>, stake_amount: u64) -> Result<()> {
        instructions::register_operator::handler_register_operator(ctx, stake_amount)
    }

    /// Deregister as an operator and recover stake
    ///
    /// # Returns
    /// * Full stake amount returned to operator
    /// * Operator account is closed
    pub fn deregister_operator(ctx: Context<DeregisterOperator>) -> Result<()> {
        instructions::deregister_operator::handler_deregister_operator(ctx)
    }

    /// Request operator stake withdrawal (starts cooldown)
    ///
    /// This is step 1 of a 2-step flow:
    /// 1) request_operator_withdrawal
    /// 2) deregister_operator (after cooldown)
    pub fn request_operator_withdrawal(ctx: Context<RequestOperatorWithdrawal>) -> Result<()> {
        instructions::request_operator_withdrawal::handler_request_operator_withdrawal(ctx)
    }

    /// Execute a liquidation (mock implementation for testing)
    ///
    /// # Arguments
    /// * `profit` - Profit from the liquidation (will be properly calculated in production)
    ///
    /// # Profit Distribution
    /// * 5% -> Protocol fee vault
    /// * 15% -> Operator
    /// * 80% -> Pool depositors (increases share value)
    pub fn execute_liquidation(ctx: Context<ExecuteLiquidation>, profit: u64) -> Result<()> {
        instructions::execute_liquidation::handler_execute_liquidation(ctx, profit)
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
    /// * No liquidations allowed
    pub fn pause_pool(ctx: Context<PausePool>, paused: bool) -> Result<()> {
        instructions::admin::handler_pause_pool(ctx, paused)
    }

    /// Update fee configuration (admin only)
    ///
    /// # Arguments
    /// * `protocol_fee_bps` - Protocol fee in basis points (max 2000 = 20%)
    /// * `operator_fee_bps` - Operator fee in basis points (max 3000 = 30%)
    /// * `depositor_share_bps` - Depositor share in basis points
    ///
    /// # Requirements
    /// * All three must sum to exactly 10000 (100%)
    pub fn update_fees(
        ctx: Context<UpdateFees>,
        protocol_fee_bps: u16,
        operator_fee_bps: u16,
        depositor_share_bps: u16,
    ) -> Result<()> {
        instructions::admin::handler_update_fees(ctx, protocol_fee_bps, operator_fee_bps, depositor_share_bps)
    }

    /// Update operator cooldown (admin only)
    ///
    /// - 0 means immediate withdrawal is allowed once requested (good for devnet tests)
    /// - Set to e.g. 7 days before mainnet launch
    pub fn update_operator_cooldown(
        ctx: Context<UpdateOperatorCooldown>,
        cooldown_seconds: i64,
    ) -> Result<()> {
        instructions::admin::handler_update_operator_cooldown(ctx, cooldown_seconds)
    }

    /// Withdraw accumulated protocol fees (admin only)
    ///
    /// Transfers all fees from protocol fee vault to admin's token account
    pub fn withdraw_protocol_fees(ctx: Context<WithdrawProtocolFees>) -> Result<()> {
        instructions::admin::handler_withdraw_protocol_fees(ctx)
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
