// =============================================================================
// Instructions Module
// =============================================================================
// This module exports all instructions for the VULTR protocol.
//
// Instructions are the "API" of the Solana program - each one represents
// an action that can be taken by calling the program.
// =============================================================================

// Core pool operations
pub mod deposit;
pub mod initialize_pool;
pub mod withdraw;

// Operator operations
pub mod deregister_operator;
pub mod execute_liquidation;
pub mod complete_liquidation;
pub mod register_operator;
pub mod request_operator_withdrawal;

// Admin operations
pub mod admin;

// Re-export everything from each module
// The #[derive(Accounts)] macro generates helper types that need to be at crate root
pub use admin::*;
pub use complete_liquidation::*;
pub use deregister_operator::*;
pub use deposit::*;
pub use execute_liquidation::*;
pub use initialize_pool::*;
pub use register_operator::*;
pub use request_operator_withdrawal::*;
pub use withdraw::*;
