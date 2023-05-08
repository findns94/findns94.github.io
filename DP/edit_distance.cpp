//
// Created by FindNS on 2022/3/14.
//

#include "dp_common.h"

// dp[i][j]代表:word1[i]位置到word2[j]位置需要的最少步数
// 1.word[i] == word[j],不需要修改,dp[i][j] = dp[i-1][j-1]
// 3种修改方式
// 2.1 替换 dp[i-1][j-1] => dp[i][j] => a
// 2.2 删除 dp[i-1][j]   => dp[i][j] => b
// 2.3 插入 dp[i][j-1]   => dp[i][j] => c
// dp[i][j] = min(a,b,c) + 1

int minDistance(string word1, string word2) {
    int n = word1.size();
    int m = word2.size();
    if (m == 0) {
        return n;
    }
    if (n == 0) {
        return m;
    }
    vector<vector<int>> dp(n + 1, vector<int>(m + 1));
    for (int i = 0; i <= n; ++i) {
        dp[i][0] = i;
    }
    for (int j = 0; j <= m; ++j) {
        dp[0][j] = j;
    }
    for (int i = 1; i <= n; ++i) {
        for (int j = 1; j <= m; ++j) {
            if (word1[i-1] == word2[j-1]) {
                dp[i][j] = dp[i-1][j-1];
            } else {
                dp[i][j] = min(min(dp[i-1][j], dp[i][j-1]), dp[i-1][j-1]) + 1;
            }
        }
    }
    return dp[n][m];
}

void testcase()
{
    string word1 = "horse";
    string word2 = "ros";
    printf("%d\n", minDistance(word1, word2));
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}
