#!/bin/bash

# VULTR Protocol Devnet Test Script
# Tests the complete protocol flow using Solana CLI and Anchor

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CLUSTER="devnet"
PROGRAM_ID="7EhoUeYzjKJB27aoMA4tXoLc9kj6bESVyzwjsN2rUbAe"
WALLET="bot/test-wallet.json"

echo -e "${BLUE}=================================${NC}"
echo -e "${BLUE}VULTR DEVNET TEST SUITE${NC}"
echo -e "${BLUE}=================================${NC}\n"

# Step 1: Check wallet balance
echo -e "${YELLOW}Step 1: Checking wallet balance...${NC}"
BALANCE=$(solana balance -k $WALLET --url $CLUSTER | awk '{print $1}')
echo -e "${GREEN}✅ Wallet balance: $BALANCE SOL${NC}\n"

# Step 2: Verify program deployment
echo -e "${YELLOW}Step 2: Verifying program deployment...${NC}"
solana program show $PROGRAM_ID --url $CLUSTER > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Program verified on-chain${NC}\n"
else
    echo -e "${RED}❌ Program not found on devnet${NC}\n"
    exit 1
fi

# Step 3: Check if we need devnet USDC
echo -e "${YELLOW}Step 3: Getting devnet USDC...${NC}"
echo -e "${BLUE}ℹ️  Using SPL Token Faucet for devnet USDC${NC}"
echo -e "${BLUE}ℹ️  Devnet USDC Mint: Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr${NC}\n"

# Get wallet public key
WALLET_PUBKEY=$(solana address -k $WALLET)
echo -e "${GREEN}Wallet address: $WALLET_PUBKEY${NC}\n"

# Step 4: Create ATA for devnet USDC if needed
echo -e "${YELLOW}Step 4: Setting up token accounts...${NC}"
USDC_MINT="Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"

# Create ATA
spl-token create-account $USDC_MINT --owner $WALLET_PUBKEY --url $CLUSTER -k $WALLET 2>/dev/null || echo -e "${BLUE}Token account already exists${NC}"

# Get token account address
TOKEN_ACCOUNT=$(spl-token address --token $USDC_MINT --owner $WALLET_PUBKEY --verbose 2>&1 | grep -oP '(?<=Address: )[A-Za-z0-9]+' || spl-token accounts --owner $WALLET_PUBKEY --url $CLUSTER 2>&1 | grep $USDC_MINT | awk '{print $1}')
echo -e "${GREEN}✅ Token account: $TOKEN_ACCOUNT${NC}\n"

# Step 5: Request airdrop from USDC faucet
echo -e "${YELLOW}Step 5: Requesting USDC from faucet...${NC}"
echo -e "${BLUE}Visit: https://faucet.circle.com/${NC}"
echo -e "${BLUE}Or use: https://spl-token-faucet.com/?token-name=USDC${NC}\n"

# Check current balance
USDC_BALANCE=$(spl-token balance $USDC_MINT --owner $WALLET_PUBKEY --url $CLUSTER 2>/dev/null || echo "0")
echo -e "${GREEN}Current USDC balance: $USDC_BALANCE${NC}\n"

if [ "$(echo "$USDC_BALANCE < 100000" | bc -l 2>/dev/null || echo 1)" -eq 1 ]; then
    echo -e "${YELLOW}⚠️  Low USDC balance. Need at least 100,000 USDC for testing.${NC}"
    echo -e "${YELLOW}Please get USDC from a devnet faucet:${NC}"
    echo -e "${BLUE}1. https://faucet.circle.com/${NC}"
    echo -e "${BLUE}2. https://spl-token-faucet.com/?token-name=USDC${NC}"
    echo -e "${BLUE}3. Token address: $TOKEN_ACCOUNT${NC}\n"

    read -p "Press Enter once you have USDC..."

    # Check again
    USDC_BALANCE=$(spl-token balance $USDC_MINT --owner $WALLET_PUBKEY --url $CLUSTER)
    echo -e "${GREEN}New USDC balance: $USDC_BALANCE${NC}\n"
fi

# Step 6: Show next steps
echo -e "${GREEN}=================================${NC}"
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo -e "${GREEN}=================================${NC}\n"

echo -e "${YELLOW}Next Steps (manual for now):${NC}"
echo -e "1. Initialize pool with USDC mint: $USDC_MINT"
echo -e "2. Register as operator with minimum 10,000 USDC stake"
echo -e "3. Make test deposits"
echo -e "4. Execute test liquidation\n"

echo -e "${BLUE}Program ID: $PROGRAM_ID${NC}"
echo -e "${BLUE}Wallet: $WALLET_PUBKEY${NC}"
echo -e "${BLUE}USDC Balance: $USDC_BALANCE${NC}\n"

echo -e "${GREEN}🎉 Ready for protocol testing!${NC}"
