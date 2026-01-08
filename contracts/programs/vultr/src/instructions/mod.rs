// =============================================================================
// Instructions Module - NEW SIMPLIFIED DESIGN
// =============================================================================
// This module exports all instructions for the VULTR protocol.
//
// KEY CHANGES FROM OLD DESIGN:
// - Removed: register_operator, deregister_operator, request_operator_withdrawal
// - Removed: execute_liquidation, complete_liquidation (complex 2-step flow)
// - Added: record_profit (simple profit recording by bot_wallet)
// =============================================================================

// Core pool operations
pub mod deposit;
pub mod initialize_pool;
pub mod withdraw;

// Profit recording (called by bot_wallet)
pub mod record_profit;

// Admin operations
pub mod admin;
pub mod update_pool_cap;

// Re-export everything from each module
pub use admin::*;
pub use deposit::*;
pub use initialize_pool::*;
pub use record_profit::*;
pub use update_pool_cap::*;
pub use withdraw::*;
