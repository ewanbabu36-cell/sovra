package types

import (
	"errors"
)

var (
	ErrInvalidCoin            = errors.New("invalid coin denomination or amount")
	ErrEpochAllowanceExceeded = errors.New("mint amount exceeds remaining epoch allowance")
	ErrPoolCapExceeded        = errors.New("mint amount exceeds pool lifetime cap")
	ErrGlobalCapExceeded      = errors.New("mint amount exceeds global lifetime cap of 100M SOV")
	ErrTerminalPhaseActive    = errors.New("emission period has permanently terminated (9,125 epochs completed)")
	ErrPreGenesisBlock        = errors.New("block timestamp is before genesis")
	ErrInsufficientBalance    = errors.New("insufficient balance for burn")
	ErrUnauthorizedCaller     = errors.New("unauthorized caller for emission capability")
	ErrInvalidSigner          = errors.New("invalid or spoofed transaction signer")
	ErrSupplyInvariantBroken  = errors.New("master supply invariant violation: BankSupply != LifetimeMinted - LifetimeBurned")
)
