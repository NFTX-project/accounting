var fs = require("fs");
const BN = require("bn.js");

const depositsData = require("./input/deposits.json");
const withdrawalsData = require("./input/withdrawals.json");
const feesData = require("./input/fees.json");
const claimsData = require("./input/claims.json");

const { deposits } = depositsData.data;
const { withdrawals } = withdrawalsData.data;
const { feeReceipts } = feesData.data;
const fees = feeReceipts.map((f) => {
  f.type = "fee";
  f.fee = true;
  return f;
});

// 1000000000000000000
const bigNumOne = () => {
  let retVal = new BN(10);
  return retVal.pow(new BN(18));
};

// events = deposits + fees + withdrawals
const events = deposits.concat(fees).concat(withdrawals);

// sort events by blockNumber, if same blockNumber then go:
// (1) deposits, (2) fees, (3) withdrawals
// this maximizes user rewards to err on side of caution
events.sort((a, b) => {
  let retVal = parseInt(a.date) - parseInt(b.date);
  if (retVal != 0) {
    return retVal;
  } else {
    if (a.deposit) {
      return -1;
    } else if (b.deposit) {
      return 1;
    } else if (a.type === "fee") {
      return -1;
    } else if (b.type === "fee") {
      return 1;
    }
  }
  return 0;
});

// save events data
fs.writeFile("output/events.json", JSON.stringify(events), (err) =>
  console.log(err)
);

// vault data
const vaults = [];

const stakers = [];

for (let i = 0; i < events.length; i++) {
  let event = events[i];
  if (!event) continue;
  let vaultAddr = event.fee ? event.vault.id : event.pool.vault.id;
  let vaultTicker = event.fee
    ? event.vault.token.symbol
    : event.pool.vault.token.symbol;
  if (!vaults[vaultAddr]) {
    console.log("new vault", vaultTicker, `at event index = ${i}`);
    // if vault[vaultAddr] DNE, then create it
    vaults[vaultAddr] = {
      stakers: [],
      totalStaked: new BN(0),
      daoFees: new BN(0),
    };
  }
  let vault = vaults[vaultAddr];
  if (event.deposit || event.withdrawal) {
    let userAddr = event.user.id;
    // make list of staking addresses
    if (!stakers.includes(userAddr)) {
      stakers.push(userAddr);
    }
    if (!vault.stakers[userAddr]) {
      // if vault.stakers[userAddr] DNE, then create it
      vault.stakers[userAddr] = {
        stakedAmount: new BN(0),
        stakedPortion: new BN(0),
        feesEarned: new BN(0),
      };
    }
    let staker = vault.stakers[userAddr];
    if (event.deposit) {
      let deposit = new BN(event.deposit);
      staker.stakedAmount = staker.stakedAmount.add(deposit);
      vault.totalStaked = vault.totalStaked.add(deposit);
    } else if (event.withdrawal) {
      let withdrawal = new BN(event.withdrawal);
      if (withdrawal.gt(staker.stakedAmount)) {
        console.error(`withdrawal too big at event index = ${i}`);
      }
      staker.stakedAmount = staker.stakedAmount.sub(withdrawal);

      vault.totalStaked = vault.totalStaked.sub(withdrawal);
    }
    let groupTotal = vault.totalStaked;
    // recalculate all staked portions (i.e. %'s)
    Object.keys(vault.stakers).forEach((k, _i) => {
      let s = vault.stakers[k];
      if (groupTotal.eq(new BN(0))) {
        // if total = 0, then stakedPortion = 0
        s.stakedPortion = new BN(0);
      } else if (s.stakedAmount.eq(new BN(0))) {
        // if stakedAmount = 0, then stakedPortion = 0
        s.stakedPortion = new BN(0);
      } else {
        // calculated staked portion out of total
        s.stakedPortion = s.stakedAmount.mul(bigNumOne()).div(groupTotal);
        if (s.stakedPortion.gt(bigNumOne())) {
          console.error(`s.stakedPortion.gt(bigOne()) at event index = ${i}`);
        }
      }
    });
  } else if (event.fee) {
    let feeAmount = new BN(event.amount);
    let accRewards = new BN(0);
    let noStakers = true;
    // iterate through all stakers
    Object.keys(vault.stakers).forEach((k, _i) => {
      let s = vault.stakers[k];
      if (s.stakedPortion.eq(new BN(0))) {
        return; // skip
      } else {
        noStakers = false;
      }
      // calculate individual reward
      let reward = feeAmount.mul(s.stakedPortion).div(bigNumOne());
      // add to total fees earned by staker
      s.feesEarned = s.feesEarned.add(reward);
      accRewards = accRewards.add(reward);
      if (accRewards.gt(feeAmount)) {
        console.error(
          "accRewards > feeAmount by ",
          accRewards.sub(feeAmount).toString(),
          `at event index = ${i}`
        );
      }
    });
    if (noStakers) {
      vault.daoFees = vault.daoFees.add(feeAmount);
    }
  }
}

// save vaults data

fs.writeFile("output/vaults.json", JSON.stringify(vaults), (err) =>
  console.log(err)
);

fs.writeFile("output/stakers.json", JSON.stringify(stakers), (err) =>
  console.log(err)
);
