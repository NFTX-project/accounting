var fs = require("fs");
const BN = require("bn.js");

const vaultAddrs = require("./input/vaultAddrs.json");
const depositsData = require("./input/deposits.json");
const withdrawalsData = require("./input/withdrawals.json");
const feesData = require("./input/fees.json");
const zapsData = require("./input/zaps.json");
const claimsData = require("./input/claims.json");

const { deposits } = depositsData.data;
const { withdrawals } = withdrawalsData.data;
const { feeReceipts } = feesData.data;
const fees = feeReceipts.map((f) => {
  f.type = "fee";
  f.fee = true;
  return f;
});

const getVaultAddr = (vaultId) => {
  return vaultAddrs.find((v) => v.vaultId == vaultId).id;
};

const getVaultId = (vaultAddr) => {
  return vaultAddrs.find((v) => v.id == vaultAddr).vaultId;
};

const getTicker = (vAddr) => {
  if (vAddr == "0x53e305c27444232ebf6712ee361c4906c5e8058a") {
    return "RABBIT";
  } else if (vAddr == "0x62c30556fde78b3423075758dc3fb74e2eccbfe4") {
    return "CYPHER";
  } else if (vAddr == "0xf887f2af215f985ae74b80b8fb29e3ed5a238407") {
    return "DBS";
  } else if (vAddr == "0x6ce848f188dc4feed490f221e7332feb7af00993") {
    return "RAT";
  } else if (vAddr == "0xb915f83f5744c3317add69f8b2653dd35c25cd26") {
    return "MARS";
  } else if (vAddr == "0x85f373ef7d3d4c2675e6215242670987e35886e2") {
    return "DINO";
  } else {
    return "/?";
  }
};

// 1000000000000000000
const bigNumOne = () => {
  let retVal = new BN(10);
  return retVal.pow(new BN(18));
};

const getFloatString = (bigNum) => {
  if (!BN.isBN(bigNum)) return bigNum;
  let left = bigNum.div(bigNumOne());
  let right = bigNum.sub(left);
  let rightLength = right.toString().length;
  let rightString = right.toString();
  for (let i = rightLength; i < 18; i++) {
    rightString = "0" + rightString;
  }
  if (right.eq(new BN(0))) {
    rightString = "0";
  } else if (rightString.substring(0, 6) == "000000") {
    rightString = "000001";
  } else {
    rightString = rightString.substring(0, 6);
  }
  return `${left}.${rightString}`;
};

// events = deposits + fees + withdrawals
const events = deposits.concat(fees).concat(withdrawals);

// add zap data to events
zapsData.data.zaps.forEach((zap) => {
  let userAddr = zap.user.id;
  let vaultId = zap.vaultId;
  let vaultAddr = getVaultAddr(vaultId);
  if (zap.deposits && zap.deposits.length > 0) {
    let data = zap.deposits[0];
    events.push({
      date: data.date,
      deposit: data.amount,
      pool: {
        vault: {
          id: vaultAddr,
          token: {
            symbol: "/?",
          },
        },
      },
      user: {
        id: userAddr,
      },
      zap: true,
    });
  }
  // if (zap.withdrawals && zap.withdrawals.length > 0) {
  //   let data = zap.withdrawals[0];
  //   events.push({
  //     date: data.date,
  //     withdrawal: data.amount,
  //     pool: {
  //       vault: {
  //         id: vaultAddr,
  //         token: {
  //           symbol: "/?",
  //         },
  //       },
  //     },
  //     user: {
  //       id: userAddr,
  //     },
  //     zap: true,
  //   });
  // }
});

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
const vaults = {};

const stakers = [];

for (let i = 0; i < events.length; i++) {
  let event = events[i];
  if (!event) continue;
  let vaultAddr = event.fee ? event.vault.id : event.pool.vault.id;
  let vaultTicker = event.fee
    ? event.vault.token.symbol
    : event.pool.vault.token.symbol;
  if (!vaults[vaultAddr]) {
    // console.log("new vault", vaultTicker, `at event index = ${i}`);
    // if vault[vaultAddr] DNE, then create it
    vaults[vaultAddr] = {
      stakers: {},
      totalStaked: new BN(0),
      daoFees: new BN(0),
      ticker: vaultTicker,
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
        feesClaimed: new BN(0),
        feesEarnedString: "0.0",
        feesClaimedString: "0.0",
      };
    }
    let stakerData = vault.stakers[userAddr];
    if (event.deposit) {
      let deposit = new BN(event.deposit);
      stakerData.stakedAmount = stakerData.stakedAmount.add(deposit);
      vault.totalStaked = vault.totalStaked.add(deposit);
    } else if (event.withdrawal) {
      let withdrawal = new BN(event.withdrawal);
      if (withdrawal.gt(stakerData.stakedAmount)) {
        let oversize = withdrawal.sub(stakerData.stakedAmount);
        let overSizeAmount = getFloatString(oversize);
        console.error(
          `withdrawal too big at event index = ${i} by amount ${overSizeAmount} by account ${userAddr.substring(
            0,
            8
          )} on vault ${vaultTicker}`
        );
        // write to issues
        fs.writeFile(
          `./output/issues/${userAddr.substring(0, 8)}-${vaultAddr.substring(
            0,
            8
          )}.json`,
          JSON.stringify(
            events.filter(
              (e) =>
                (e.deposit || e.withdrawal) &&
                e.user.id == userAddr &&
                e.pool.vault.id == vaultAddr
            )
          ),
          (err) => console.log(err)
        );
      }
      stakerData.stakedAmount = stakerData.stakedAmount.sub(withdrawal);

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
      s.feesEarnedString = getFloatString(s.feesEarned);
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

claimsData.data.rewards.sort((a, b) => {
  return parseInt(a.date) - parseInt(b.date);
});

claimsData.data.rewards.forEach((claim) => {
  let userAddr = claim.user.id;
  let vaultAddr = claim.pool.vault.id;
  let amount = new BN(claim.reward);
  let stakerData = vaults[vaultAddr].stakers[userAddr];
  stakerData.feesClaimed = stakerData.feesClaimed.add(amount);
  stakerData.feesClaimedString = getFloatString(stakerData.feesClaimed);
});

const resultsLost = [];
const resultsOwed = [];

Object.keys(vaults).forEach((vaultAddr) => {
  let vault = vaults[vaultAddr];
  if (vault.ticker == "/?") {
    vault.ticker = getTicker(vaultAddr);
  }
  let totalFeesEarned = new BN(0);
  let totalFeesClaimed = new BN(0);
  let totalFeesLost = new BN(0);
  let totalFeesOwed = new BN(0);
  let totalLuckyStakers = 0;
  let totalStakersOwed = 0;
  Object.keys(vault.stakers).forEach((stakerAddr) => {
    let stakerData = vault.stakers[stakerAddr];
    totalFeesEarned = totalFeesEarned.add(stakerData.feesEarned);
    totalFeesClaimed = totalFeesClaimed.add(stakerData.feesClaimed);
    if (stakerData.feesClaimed.gt(stakerData.feesEarned)) {
      stakerData.stole = stakerData.feesClaimed.sub(stakerData.feesEarned);
      totalFeesLost = totalFeesLost.add(stakerData.stole);
      totalLuckyStakers += 1;
    } else if (stakerData.feesClaimed.lt(stakerData.feesEarned)) {
      stakerData.owed = stakerData.feesEarned.sub(stakerData.feesClaimed);
      stakerData.owedString = stakerData.owed.toString();
      totalFeesOwed = totalFeesOwed.add(stakerData.owed);
      totalStakersOwed += 1;
    }
  });
  vault.totals = {
    totalFeesEarned,
    totalFeesClaimed,
    totalFeesLost,
    totalFeesOwed,
    totalLuckyStakers,
    totalStakersOwed,
  };
  let resultObj = {
    ticker: vault.ticker,
    addr: vaultAddr,
  };
  Object.keys(vault.totals).forEach((key) => {
    resultObj[key] = getFloatString(vault.totals[key]);
    // resultObj[key] = vault.totals[key].toString();
  });
  if (resultObj.totalLuckyStakers > 0) {
    resultsLost.push(resultObj);
  }
  if (resultObj.totalStakersOwed > 0) {
    resultsOwed.push(resultObj);
  }
});

[resultsLost, resultsOwed].forEach((arr) => {
  arr.sort((a, b) => {
    aVaultId = parseInt(getVaultId(a.addr));
    bVaultId = parseInt(getVaultId(b.addr));
    return aVaultId - bVaultId;
  });
  arr.forEach((v) => {
    let vStakers = vaults[v.addr].stakers;
    let newVStakers = [];
    Object.keys(vStakers).forEach((stakerAddr) => {
      stakerData = vStakers[stakerAddr];
      newVStakers.push({
        addr: stakerAddr,
        token: v.ticker,
        feesEarned: getFloatString(stakerData.feesEarned),
        feesClaimed: getFloatString(stakerData.feesClaimed),
        feesOwed: getFloatString(stakerData.owed),
      });
    });
    v.stakers = newVStakers;
    v.csv = v.stakers
      .filter(
        (s) =>
          s.feesOwed &&
          s.feesOwed != "0.0" &&
          s.addr != "0x0b8ee2ee7d6f3bfb73c9ae2127558d1172b65fb1"
      )
      .map((s) => `${s.addr},${s.feesOwed}`)
      .join(`\n`);
  });
});

fs.writeFile("./output/vaults.json", JSON.stringify(vaults), (err) =>
  console.log(err)
);

fs.writeFile("./output/tokensLost.json", JSON.stringify(resultsLost), (err) =>
  console.log(err)
);

fs.writeFile("./output/tokensOwed.json", JSON.stringify(resultsOwed), (err) =>
  console.log(err)
);
