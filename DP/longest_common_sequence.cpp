//
// Created by FindNS on 2022/4/13.
//

#include "dp_common.h"

// dp[i][j]表示字符串text1的[1,i]区间和字符串text2的[1,j]区间的最长公共子序列长度
// 下标从1开始
// 1. dp[i][j] = dp[i-1][j-1] + 1,若text1[i]==text2[j],两个字符串的最后一位相等
// 2. dp[i][j] = max(dp[i-1][j],dp[i][j-1]),若text1[i]!=text2[j]
// 3. 初始化dp[i][0]=dp[0][i]=0, 空字符串与有长度的字符串的最长公共子序列长度肯定为0

// https://leetcode-cn.com/problems/longest-common-subsequence/solution/zui-chang-gong-gong-zi-xu-lie-tu-jie-dpz-6mvz/
int longestCommonSubsequence(string text1, string text2) {
    int n = text1.size();
    int m = text2.size();
    vector<vector<int>> dp(n+1, vector<int>(m+1,0));
    for (int i = 1; i <= n; ++i) { // 注意:i,j从下标为1开始
        for (int j = 1; j <= m; ++j) {
            if (text1[i - 1] == text2[j - 1]) { // 注意:此处为i-1
                dp[i][j] = dp[i-1][j-1] + 1;
            } else {
                dp[i][j] = max(dp[i-1][j], dp[i][j-1]);
            }
        }
    }
    return dp[n][m];
}

void testcase()
{
    string word1 = "abcde";
    string word2 = "ace";
    int ret = longestCommonSubsequence(word1, word2);
    printf("%d\n", ret);
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}
