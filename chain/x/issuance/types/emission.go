package types

import (
	"cosmossdk.io/math"
)

// CanonicalAnnualSeederSchedule returns the pre-calculated 25-year Seeder budget in uSOV.
// It is derived strictly from the recurrence:
// S[1] = 726653680570
// S[y] = (S[y-1]*189 + 100) // 200 for y in [2..24]
// S[25] = 10_000_000_000_000 - sum(S[1..24]) = 186935111695
var CanonicalAnnualSeederSchedule = [25]int64{
	726653680570, // Y01
	686687728139, // Y02
	648919903091, // Y03
	613229308421, // Y04
	579501696458, // Y05
	547629103153, // Y06
	517509502480, // Y07
	489046479844, // Y08
	462148923453, // Y09
	436730732663, // Y10
	412710542367, // Y11
	390011462537, // Y12
	368560832097, // Y13
	348289986332, // Y14
	329134037084, // Y15
	311031665044, // Y16
	293924923467, // Y17
	277759052676, // Y18
	262482304779, // Y19
	248045778016, // Y20
	234403260225, // Y21
	221511080913, // Y22
	209327971463, // Y23
	197814933033, // Y24
	186935111695, // Y25 (Exact Residual)
}

// GenerateCanonicalSeederSchedule dynamically computes the canonical recurrence.
// It matches CanonicalAnnualSeederSchedule identically down to 1 uSOV.
func GenerateCanonicalSeederSchedule() [25]int64 {
	var sched [25]int64
	sched[0] = 726653680570

	var sumPrior int64 = sched[0]
	for y := 1; y < 24; y++ {
		// Pure integer recurrence with nearest half-up rounding:
		sched[y] = (sched[y-1]*189 + 100) / 200
		sumPrior += sched[y]
	}
	// Year 25 residual to hit exactly 10,000,000,000,000 uSOV (10M SOV)
	sched[24] = 10_000_000_000_000 - sumPrior
	return sched
}

// GetAnnualPoolAllocations returns (E_y, V_y, C_y, S_y) for year y in [1..25].
func GetAnnualPoolAllocations(year int) (totalE, valV, commC, seedS math.Int) {
	if year < 1 || year > 25 {
		return math.ZeroInt(), math.ZeroInt(), math.ZeroInt(), math.ZeroInt()
	}
	s := math.NewInt(CanonicalAnnualSeederSchedule[year-1])
	v := s.MulRaw(2)
	c := s.MulRaw(4)
	e := s.MulRaw(7) // e = v + c + s
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

// ComputeEpochAllowance calculates the daily allocation for epoch e in [1..9125].
// It guarantees that the 2:4:1 ratio (V:C:S) holds exactly on EVERY single daily epoch.
func ComputeEpochAllowance(epoch uint64) (valV, commC, seedS math.Int) {
	if epoch < 1 || epoch > TotalPolicyEpochs {
		return math.ZeroInt(), math.ZeroInt(), math.ZeroInt()
	}

	// 1-indexed year in [1..25] and day in [1..365]
	yearIdx := int((epoch-1)/365) + 1
	dayIdx := int((epoch-1)%365) + 1

	annualS := math.NewInt(CanonicalAnnualSeederSchedule[yearIdx-1])
	sBase := annualS.QuoRaw(365)

	var sDay math.Int
	if dayIdx < 365 {
		sDay = sBase
	} else {
		// Day 365 reconciliation: absorbs remaining Seeder dust for that year
		sDay = annualS.Sub(sBase.MulRaw(364))
	}

	// Strict integer multiples guarantee exact 2:4:1 ratio on every single epoch
	vDay := sDay.MulRaw(2)
	cDay := sDay.MulRaw(4)

	return vDay, cDay, sDay
}
