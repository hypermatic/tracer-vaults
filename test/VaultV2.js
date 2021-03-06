const { expect, assert } = require("chai")

describe("VaultV2", async () => {
    let vault
    let vaultFactory
    let owner
    let underlying
    let baseUnit = ethers.utils.parseEther("1") //18 decimals default
    let accounts
    let mockStrategy

    beforeEach(async () => {
        accounts = await ethers.getSigners()
        vaultFactory = await ethers.getContractFactory("VaultV2")
        let strategyFactory = await ethers.getContractFactory("MockStrategy")
        let ERC20Factory = await ethers.getContractFactory("TestERC20")
        underlying = await ERC20Factory.deploy("Test Token", "TST")
        for (var i = 0; i < 10; i++) {
            await underlying.mint(
                ethers.utils.parseEther("10"),
                accounts[i].address
            )
        }

        mockStrategy = await strategyFactory.deploy()
        vault = await vaultFactory.deploy(
            underlying.address,
            baseUnit,
            [mockStrategy.address],
            [ethers.utils.parseEther("0.95")]
        )

        await mockStrategy.init(vault.address, underlying.address)
    })

    describe("constructor", async () => {
        it("records correct state variables", async () => {
            let asset = await vault.asset()
            let _baseUnit = await vault.BASE_UNIT()
            let _owner = await vault.owner()
            let _strategies = await vault.strategies(0)
            let _percentAllocations = await vault.percentAllocations(0)

            assert.equal(asset, underlying.address)
            assert.equal(_baseUnit.toString(), baseUnit.toString())
            assert.equal(_owner, accounts[0].address)
            assert.equal(_strategies, mockStrategy.address)
            assert.equal(
                _percentAllocations.toString(),
                ethers.utils.parseEther("0.95").toString()
            )
        })

        it("reverts if the percent allocated to strategies is > 100", async () => {
            await expect(
                (vault = vaultFactory.deploy(
                    underlying.address,
                    baseUnit,
                    [mockStrategy.address],
                    [ethers.utils.parseEther("1.01")]
                ))
            ).to.be.revertedWith("PERC_SUM_MAX")
        })

        it("reverts if strategies is not the same length as percentages", async () => {
            await expect(
                (vault = vaultFactory.deploy(
                    underlying.address,
                    baseUnit,
                    [mockStrategy.address],
                    [
                        ethers.utils.parseEther("0.5"),
                        ethers.utils.parseEther("0.5"),
                    ]
                ))
            ).to.be.revertedWith("LEN_MISMATCH")
        })

        it("reverts if there are duplicate strategies", async () => {
            await expect(
                (vault = vaultFactory.deploy(
                    underlying.address,
                    baseUnit,
                    [mockStrategy.address, mockStrategy.address],
                    [
                        ethers.utils.parseEther("0.5"),
                        ethers.utils.parseEther("0.5"),
                    ]
                ))
            ).to.be.revertedWith("DUP_STRAT")
        })
    })

    describe("deposit", async () => {
        beforeEach(async () => {
            await underlying.approve(
                vault.address,
                ethers.utils.parseEther("1")
            )
            await vault.deposit(
                ethers.utils.parseEther("1"),
                accounts[0].address
            )
        })
        it("distributes funds to the strategies", async () => {
            // 95% of funds go to strategy 0
            let strategyBalance = await underlying.balanceOf(
                mockStrategy.address
            )
            assert.equal(
                strategyBalance.toString(),
                ethers.utils.parseEther("0.95").toString()
            )
            // 5% stay with the vault
            let vaultBalance = await underlying.balanceOf(vault.address)
            assert.equal(
                vaultBalance.toString(),
                ethers.utils.parseEther("0.05").toString()
            )
        })

        it("issues correct vault shares", async () => {
            let vaultBalance = await vault.balanceOf(accounts[0].address)
            assert.equal(vaultBalance.toString(), ethers.utils.parseEther("1"))
        })

        it("reverts on insufficient approval", async () => {
            await expect(
                vault
                    .connect(accounts[1])
                    .deposit(ethers.utils.parseEther("1"), accounts[1].address)
            ).to.be.revertedWith("ERC20: insufficient allowance")
        })
    })

    describe("mint", async () => {
        beforeEach(async () => {
            await underlying.approve(
                vault.address,
                ethers.utils.parseEther("1")
            )
            await vault.mint(ethers.utils.parseEther("1"), accounts[0].address)
        })

        it("distributes funds to the strategies", async () => {
            // 95% of funds go to strategy 0
            let strategyBalance = await underlying.balanceOf(
                mockStrategy.address
            )
            assert.equal(
                strategyBalance.toString(),
                ethers.utils.parseEther("0.95").toString()
            )
            // 5% stay with the vault
            let vaultBalance = await underlying.balanceOf(vault.address)
            assert.equal(
                vaultBalance.toString(),
                ethers.utils.parseEther("0.05").toString()
            )
        })

        it("issues correct vault shares", async () => {
            // alter the exchange rate. 1 share = 2 units of collateral
            await mockStrategy.setValue(ethers.utils.parseEther("1.95"))

            //  approve from account 1
            await underlying
                .connect(accounts[1])
                .approve(vault.address, ethers.utils.parseEther("2"))

            // mint 1 share, this takes 2 units of collateral at the current ratio
            let underlyingBalanceBefore = await underlying.balanceOf(
                accounts[1].address
            )

            // mint should mint 1 share for 2 units of collateral
            await vault
                .connect(accounts[1])
                .mint(ethers.utils.parseEther("1"), accounts[1].address)

            let underlyingBalanceAfter = await underlying.balanceOf(
                accounts[1].address
            )

            // should issue 1 shares to account 1
            // should cost account 2 units of collateral
            let vaultBalance = await vault.balanceOf(accounts[1].address)
            assert.equal(
                vaultBalance.toString(),
                ethers.utils.parseEther("1").toString()
            )
            assert.equal(
                underlyingBalanceBefore.sub(underlyingBalanceAfter).toString(),
                ethers.utils.parseEther("2").toString()
            )
        })

        it("reverts on insufficient approval", async () => {
            await expect(
                vault
                    .connect(accounts[1])
                    .mint(ethers.utils.parseEther("1"), accounts[1].address)
            ).to.be.revertedWith("ERC20: insufficient allowance")
        })
    })

    describe("updatePercentAllocations", async () => {
        it("reverts if the new percentages do not match the number of strategies", async () => {
            // default vault only has one strategy, cannot set two percentages
            await expect(
                vault.updatePercentAllocations([
                    ethers.utils.parseEther("0.5"),
                    ethers.utils.parseEther("0.5"),
                ])
            ).to.be.revertedWith("LEN_MISMATCH")
        })

        it("reverts if sum exceeds 100%", async () => {
            await expect(
                vault.updatePercentAllocations([ethers.utils.parseEther("1.1")])
            ).to.be.revertedWith("PERC_SUM_MAX")
        })

        it("reverts if the caller is not the owner", async () => {
            await expect(
                vault
                    .connect(accounts[1])
                    .updatePercentAllocations([ethers.utils.parseEther("1")])
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        it("replaces the percent allocations in the contract", async () => {
            let oldPercentAllocations = await vault.percentAllocations(0)
            assert.equal(
                oldPercentAllocations.toString(),
                ethers.utils.parseEther("0.95")
            )
            await vault.updatePercentAllocations([
                ethers.utils.parseEther("0.5"),
            ])
            let newPercentAllocations = await vault.percentAllocations(0)
            assert.equal(
                newPercentAllocations.toString(),
                ethers.utils.parseEther("0.5")
            )
        })
    })

    describe("withdraw", async () => {
        beforeEach(async () => {
            await underlying.approve(
                vault.address,
                ethers.utils.parseEther("1")
            )
            await vault.deposit(
                ethers.utils.parseEther("1"),
                accounts[0].address
            )

            // mocking: the current setup indicates 0.95 of funds are allocated to the mock
            // strategy. We need to tell the mock strategy to return this as its value for
            // tests to work. 0.95 * 1 ETH = 0.95 ETH in the mock strategy
            await mockStrategy.setValue(ethers.utils.parseEther("0.95"))
        })

        it("pays directly out of the vault if there is enough capital on hand", async () => {
            let startBalance = await underlying.balanceOf(accounts[0].address)
            // withdraw all funds in the vault
            await vault.withdraw(
                ethers.utils.parseEther("0.05"),
                accounts[0].address,
                accounts[0].address
            )
            let endBalance = await underlying.balanceOf(accounts[0].address)
            assert.equal(
                endBalance.sub(startBalance).toString(),
                ethers.utils.parseEther("0.05").toString()
            )
        })

        it("withdraws from strategies to get liquid capital to pay out", async () => {
            let startBalance = await underlying.balanceOf(accounts[0].address)
            let startingVaultBalance = await underlying.balanceOf(vault.address)
            let startingStrategyBalance = await underlying.balanceOf(
                mockStrategy.address
            )
            // withdraw all funds in the vault
            await vault.withdraw(
                ethers.utils.parseEther("1"),
                accounts[0].address,
                accounts[0].address
            )
            let endStrategyBalance = await underlying.balanceOf(
                mockStrategy.address
            )
            let endVaultBalance = await underlying.balanceOf(vault.address)
            let endBalance = await underlying.balanceOf(accounts[0].address)

            // 1 ETH pulled from vault in total

            // 0.05 came from the vault itself
            assert.equal(
                endVaultBalance.sub(startingVaultBalance).toString(),
                ethers.utils.parseEther("-0.05").toString()
            )

            // 0.95 came from the strategy
            assert.equal(
                endStrategyBalance.sub(startingStrategyBalance).toString(),
                ethers.utils.parseEther("-0.95").toString()
            )

            // in total the user gained 1 ETH worth
            assert.equal(
                endBalance.sub(startBalance).toString(),
                ethers.utils.parseEther("1").toString()
            )
        })

        it("only takes the number of shares proportional to capital returned", async () => {
            let startBalance = await underlying.balanceOf(accounts[0].address)
            let startShares = await vault.balanceOf(accounts[0].address)
            // remove funds from strategy so user cannot get paid out enough
            await mockStrategy.transferFromStrategy(
                accounts[1].address,
                ethers.utils.parseEther("0.95")
            )
            // pretend the strategy still has "value" in it so that this is accounted for in the total capital
            await mockStrategy.setValue(ethers.utils.parseEther("0.95"))

            await vault.withdraw(
                ethers.utils.parseEther("1"),
                accounts[0].address,
                accounts[0].address
            )
            let endBalance = await underlying.balanceOf(accounts[0].address)
            let endShares = await vault.balanceOf(accounts[0].address)

            // user only got 0.05 underlying back
            assert.equal(
                endBalance.sub(startBalance).toString(),
                ethers.utils.parseEther("0.05").toString()
            )
            // user only burned 0.05 shares
            assert.equal(
                endShares.sub(startShares).toString(),
                ethers.utils.parseEther("-0.05").toString()
            )
        })

        it("reverts if the user does not have enough shares", async () => {
            await expect(
                vault.withdraw(
                    ethers.utils.parseEther("2"),
                    accounts[0].address,
                    accounts[0].address
                )
            ).to.be.revertedWith("INSUFFICIENT_SHARES")
        })
    })

    describe("redeem", async () => {
        beforeEach(async () => {
            await underlying.approve(
                vault.address,
                ethers.utils.parseEther("1")
            )
            await vault.deposit(
                ethers.utils.parseEther("1"),
                accounts[0].address
            )

            // mocking: the current setup indicates 0.95 of funds are allocated to the mock
            // strategy. We need to tell the mock strategy to return this as its value for
            // tests to work. 0.95 * 1 ETH = 0.95 ETH in the mock strategy
            await mockStrategy.setValue(ethers.utils.parseEther("0.95"))
        })

        it("reverts if the user has insufficient shares", async () => {
            await expect(
                vault.redeem(
                    ethers.utils.parseEther("2"),
                    accounts[0].address,
                    accounts[0].address
                )
            ).to.be.revertedWith("INSUFFICIENT_SHARES")
        })

        it("withdraws the correct amount of underlying given the users shares", async () => {
            // note this test functions identically to withdraw since the ratio of shares: assets is 1:1
            let startBalance = await underlying.balanceOf(accounts[0].address)
            // withdraw all funds in the vault
            await vault.redeem(
                ethers.utils.parseEther("0.05"),
                accounts[0].address,
                accounts[0].address
            )
            let endBalance = await underlying.balanceOf(accounts[0].address)
            assert.equal(
                endBalance.sub(startBalance).toString(),
                ethers.utils.parseEther("0.05").toString()
            )
        })
    })
})
