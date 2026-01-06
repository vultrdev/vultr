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

    /// Execute a Marginfi liquidation (Step 1 of 2-step liquidation process)
    ///
    /// # Arguments
    /// * `asset_amount` - Amount of liability to repay (in deposit token base units)
    ///
    /// # Flow
    /// 1. Validates target margin account is liquidatable
    /// 2. Calls Marginfi liquidate instruction via CPI
    /// 3. Receives collateral in pool-controlled token account
    /// 4. Collateral is swapped in separate complete_liquidation instruction
    ///
    /// # Notes
    /// - This is Step 1 of a 2-step process (Marginfi CPI + Jupiter swap)
    /// - Split due to compute budget constraints
    /// - Profit distribution happens after swap in complete_liquidation
    pub fn execute_liquidation(ctx: Context<ExecuteLiquidation>, asset_amount: u64) -> Result<()> {
        instructions::execute_liquidation::handler_execute_liquidation(ctx, asset_amount)
    }

    /// Complete a liquidation by swapping collateral (Step 2 of 2-step process)
    ///
    /// # Arguments
    /// * `min_output_amount` - Minimum USDC to receive (slippage protection)
    /// * `liquidation_cost` - Amount of USDC spent in Marginfi liquidation
    /// * `jupiter_instruction_data` - Serialized Jupiter swap instruction (built off-chain by bot)
    ///
    /// # Flow
    /// 1. Reads collateral from execute_liquidation
    /// 2. Swaps collateral to USDC via Jupiter CPI
    /// 3. Calculates profit: (USDC received - liquidation_cost)
    /// 4. Distributes fees: 80% depositors, 15% operator, 5% protocol
    /// 5. Updates pool and operator state
    ///
    /// # Notes
    /// - Must be called after execute_liquidation
    /// - Jupiter instruction data is built off-chain using Jupiter SDK
    /// - All Jupiter route accounts must be passed via remaining_accounts
    /// - Uses pool's max_slippage_bps for swap protection
    /// - Requires collateral_source account to have balance
    pub fn complete_liquidation(
        ctx: Context<CompleteLiquidation>,
        min_output_amount: u64,
        liquidation_cost: u64,
        jupiter_instruction_data: Vec<u8>,
    ) -> Result<()> {
        instructions::complete_liquidation::handler_complete_liquidation(
            ctx,
            min_output_amount,
            liquidation_cost,
            jupiter_instruction_data,
        )
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

    /// Update slippage tolerance for liquidations (admin only)
    ///
    /// # Arguments
    /// * `max_slippage_bps` - Maximum slippage in basis points (0-1000)
    ///   - 100 BPS = 1%
    ///   - 300 BPS = 3% (recommended)
    ///   - 1000 BPS = 10% (maximum)
    ///
    /// # Security
    /// Slippage tolerance protects against MEV attacks and bad swap routes.
    /// Setting it too high exposes the pool to price manipulation.
    pub fn update_slippage_tolerance(
        ctx: Context<UpdateSlippageTolerance>,
        max_slippage_bps: u16,
    ) -> Result<()> {
        instructions::admin::handler_update_slippage_tolerance(ctx, max_slippage_bps)
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
