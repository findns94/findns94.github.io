//
// Created by FindNS on 2022/8/6.
//

#include "dp_common.h"

/*
 * 完全背包问题:物品可取1次
 * dp[i][j] 表示前 i 件物品体积不超过 j 的情况下能达到的最大价值
 * 状态转移方程:
 * 1. 不放物品i,           dp[i][j] = dp[i-1][j]
 * 2. 放物品i,体积w,价值v, dp[i][j] = dp[j-1][j-w] + v
 * @args weights
 * @args values
 * @args N
 * @args W
 */
int knapsack1(vector<int> weights, vector<int> values, int N, int W) {
    vector<vector<int>> dp(N + 1, vector<int>(W + 1, 0));
    for (int i = 1; i <= N; ++i) {
        int w = weights[i-1], v = values[i-1];
        for (int j = 1; j <= W; ++j) {
            if (j >= w) {
                dp[i][j] = max(dp[i-1][j], dp[i-1][j-w] + v);
            } else {
                dp[i][j] = dp[i-1][j];
            }
        }
    }
    return dp[N][W];
}

/*
 * 完全背包问题:物品可取无数次
 * 状态转移方程:
 * 1. 不放物品i,           dp[i][j] = dp[i-1][j]
 * 2. 放物品i,体积w,价值v, dp[i][j] = dp[j][j-w] + v , 与0-1背包区别在此处j vs j-1
 * @args weights
 * @args values
 * @args N
 * @args W
 */
int knapsack2(vector<int> weights, vector<int> values, int N, int W) {
    vector<vector<int>> dp(N + 1, vector<int>(W + 1, 0));
    for (int i = 1; i <= N; ++i) {
        int w = weights[i-1], v = values[i-1];
        for (int j = 1; j <= W; ++j) {
            if (j >= w) {
                dp[i][j] = max(dp[i-1][j], dp[i][j-w] + v); // difference
            } else {
                dp[i][j] = dp[i-1][j];
            }
        }
    }
    return dp[N][W];
}

int coinChange(vector<int>& coins, int amount) {
    if (coins.empty()) {
        return -1;
    }
    vector<int> dp(amount + 1, amount + 2);
    dp[0] = 0;
    for (int i = 1; i <= amount; ++i) {
        for (const int &coin : coins) {
            if (i >= coin) {
                dp[i] = min(dp[i], dp[i-coin] + 1);
            }
        }
    }
    if (dp[amount] == amount + 2) {
        return -1;
    } else {
        return dp[amount];
    }
}

void testcase()
{
    vector<int> coins = {1, 2, 5};
    int amount = 11;
    int ret = coinChange(coins, amount);
    printf("ret = %d\n", ret);
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}
