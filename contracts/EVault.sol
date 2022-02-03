// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

//todo fix import paths to solmate
import "@rari-capital/solmate/src/tokens/ERC20.sol";
import "@rari-capital/solmate/src/utils/SafeTransferLib.sol";
// import "@rari-capital/solmate/src/utils/FixedPointMathLib.sol";
import "@rari-capital/solmate/src/auth/Auth.sol";
import {Harvester} from "./Harvester.sol";
//important! Importing this library from solmate will cause the contract to fail compile
import "./utils/ERC4626.sol";
import "./utils/FixedPointMathLib.sol";

// An ERC4626 compliant vault that interacts with a strategy address and Harvester contract
abstract contract EVault is ERC4626, Harvester, Auth {
    using SafeTransferLib for ERC20;
    //lets track balances for now
    mapping(address => uint256) balances;

    //the underlying token the vault accepts
    ERC20 public immutable UNDERLYING;
    address public STRATEGY;

    constructor(ERC20 underlying) ERC4626(underlying, "Vault", "VLT") {
        UNDERLYING = ERC20(underlying);
    }

    function totalAssets() public view override returns (uint256) {
        // account for balances outstanding in bot/strategy, check balances
        return UNDERLYING.balanceOf(address(this)) + UNDERLYING.balanceOf(address(STRATEGY));
    }

    //sets the strategy address to send funds
    //Funds get sent to strategy address, and then strategy
    //address sends rewards to Harvester as they accumulate
    function setStrategy(address strategy) internal requiresAuth returns (bool) {
        STRATEGY = strategy;
        return true;
    }

    //sends funds from the vault to the strategy address
    function afterDeposit(uint256 amount) internal virtual override {
        //todo logic to distribute funds to Strategy (for bot)
        UNDERLYING.safeTransfer(STRATEGY, amount);
        //increment balance of sender
        balances[msg.sender] += amount;
    }

    //Claims rewards and sends funds from the Harvester to Vault
    function beforeWithdraw(uint256 amount) internal virtual override {
        claimRewards();
        balances[msg.sender] -= amount;
        if (UNDERLYING.balanceOf(address(this)) < amount) _transferAll(UNDERLYING, address(this));
    }
}
