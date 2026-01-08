// =============================================================================
// State Module - NEW SIMPLIFIED DESIGN
// =============================================================================
// This module exports all state account structures used by the VULTR protocol.
//
// NOTE: Operator account has been REMOVED. The new design does not have
// external operators. The team runs the bot internally using bot_wallet.
// =============================================================================

pub mod depositor;
pub mod pool;

pub use depositor::*;
pub use pool::*;
