//
// Created by FindNS on 2022/5/2.
//

#include "dp_common.h"

// 从(0,0)走到(m-1,n-1),障碍物无法通行,共有多少种走法
// 输入为棋盘二维数组,0表示可通行,1表示无法通行
// 注意:考虑第1行和第1列也存在障碍物的情况,以及输入参数的边界情况
// 移动方向:向右/向下
// 思路:DP
// dp[i][j]表示从(0,0)到达(i,j)的走法数量
// dp[i][j] = dp[i-1][j] + dp[i][j-1]
// 初始化:dp[0][...] = 1, dp[...][0] = 1

int uniquePathsWithObstacles(vector<vector<int>>& obstacleGrid) {
    int m = obstacleGrid.size();
    int n = obstacleGrid[0].size();
    if (obstacleGrid[0][0] == 1 || obstacleGrid[m-1][n-1] == 1) {
        return 0;
    }
    vector<vector<int>> dp(m, vector<int>(n, 0));
    for (int i = 0; i < m; ++i) {
        if (obstacleGrid[i][0] == 0) {
            dp[i][0] = 1;
        } else if (obstacleGrid[i][0] == 1) {
            // 若(i,0)为障碍物,则(i,0)到(m-1,0)都无法到达,初始化为0
            for (; i < m; ++i) {
                dp[i][0] = 0;
            }
            break;
        }
    }
    for (int j = 0; j < n; ++j) {
        if (obstacleGrid[0][j] == 0) {
            dp[0][j] = 1;
        } else if (obstacleGrid[0][j] == 1) {
            // 若(0,j)为障碍物,则(0,j)到(0,n-1)都无法到达,初始化为0
            for (; j < n; ++j) {
                dp[0][j] = 0;
            }
            break;
        }
    }
    for (int i = 1; i < m; ++i) {
        for (int j = 1; j < n; ++j) {
            // 若遇到障碍物,则路线无法到达
            if (obstacleGrid[i-1][j] == 1) {
                dp[i-1][j] = 0;
            }
            if (obstacleGrid[i][j-1] == 1) {
                dp[i][j-1] = 0;
            }
            dp[i][j] = dp[i-1][j] + dp[i][j-1];
        }
    }
    return dp[m-1][n-1];
}

void testcase()
{
    vector<vector<int>> nums = {
            {0,0,0},
            {0,1,0},
            {0,0,0}
    };
    int ret = uniquePathsWithObstacles(nums);
    printf("%d\n", ret);
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}

