package types

import (
	"cosmossdk.io/math"
)

// HalvingEraForEpoch returns the 0-indexed 4-year halving era for a 1-indexed daily epoch.
// Returns MaxHalvingEras when epoch is out of active policy bounds.
func HalvingEraForEpoch(epoch uint64) int {
	if epoch < 1 || epoch > TotalPolicyEpochs {
		return MaxHalvingEras
	}
	return int((epoch - 1) / uint64(HalvingIntervalEpochs))
}

// ComputeHalvingBaseDaily returns the daily Community base subsidy (1x unit) in uSOV for era k >= 0.
// Mirrors Bitcoin Core's integer bit-shift halving (base >> k), halving every 1,460 daily epochs (4 years)
// down to 1 uSOV in Era 31 and reaching 0 uSOV in Era 32 (Year 129+).
func ComputeHalvingBaseDaily(era int) int64 {
	if era < 0 || era >= MaxHalvingEras {
		return 0
	}
	return Era0CommunityBaseDaily >> uint(era)
}

// GetHalvingEraAllocations returns cumulative 4-year (totalE, valV, commC, seedS) budgets for era in [0..31].
func GetHalvingEraAllocations(era int) (totalE, valV, commC, seedS math.Int) {
	cDay := ComputeHalvingBaseDaily(era)
	if cDay <= 0 {
		return math.ZeroInt(), math.ZeroInt(), math.ZeroInt(), math.ZeroInt()
	}
	c := math.NewInt(cDay).MulRaw(int64(HalvingIntervalEpochs))
	v := c.MulRaw(2)
	s := c.MulRaw(4)
	e := c.MulRaw(7)
	return e, v, c, s
}

// GetAnnualPoolAllocations returns (E_y, V_y, C_y, S_y) for year y in [1..128] (32 four-year halving eras).
func GetAnnualPoolAllocations(year int) (totalE, valV, commC, seedS math.Int) {
	if year < 1 || year > MaxHalvingEras*4 {
		return math.ZeroInt(), math.ZeroInt(), math.ZeroInt(), math.ZeroInt()
	}
	era := (year - 1) / 4
	cDay := ComputeHalvingBaseDaily(era)
	if cDay <= 0 {
		return math.ZeroInt(), math.ZeroInt(), math.ZeroInt(), math.ZeroInt()
	}
	c := math.NewInt(cDay).MulRaw(365)
	v := c.MulRaw(2)
	s := c.MulRaw(4)
	e := c.MulRaw(7) // e = v + c + s (ratio 2:1:4)
	return e, v, c, s
}

// ResolveEpoch converts consensus block time into an epoch index using signed int64 arithmetic.
func ResolveEpoch(blockTimeUnix int64, genesisTimeUnix int64) (uint64, ProtocolPhase) {
	elapsedSec := blockTimeUnix - genesisTimeUnix

	// Signed check prevents underflow for blocks with timestamps before genesis
	if elapsedSec < 0 {
		return 0, PhasePreGenesis
	}

	epoch := uint64(elapsedSec/int64(EpochDurationSeconds)) + 1

	if epoch > TotalPolicyEpochs {
		return epoch, PhaseTerminal
	}

	return epoch, PhaseActive
}

// ComputeEpochAllowance calculates the daily allocation (valV, commC, seedS) for epoch e in [1..46720].
// Uses Bitcoin-inspired 4-year bit-shift halving (50% cut every 1,460 epochs) and preserves the exact
// 2:1:4 (Validator : Community : Seeder) integer ratio on every active daily epoch.
func ComputeEpochAllowance(epoch uint64) (valV, commC, seedS math.Int) {
	era := HalvingEraForEpoch(epoch)
	cBase := ComputeHalvingBaseDaily(era)
	if cBase <= 0 {
		return math.ZeroInt(), math.ZeroInt(), math.ZeroInt()
	}

	cDay := math.NewInt(cBase)
	vDay := cDay.MulRaw(2)
	sDay := cDay.MulRaw(4)

	return vDay, cDay, sDay
}
