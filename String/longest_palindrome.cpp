//
// Created by FindNS on 2022/4/12.
//

#include "string_common.h"

// 中心扩展法
string longestPalindrome(string s) {
    string ans = "";
    for (int i = 0; i < s.length(); ++i) {
        // 回文子串长度为奇数
        int l = i - 1;
        int r = i + 1;
        while (l >= 0 && r < s.length() && s[l] == s[r]) {
            l--;
            r++;
        }
        if (ans.length() < r - l - 1) {
            ans = s.substr(l + 1, r - l - 1);
        }
        // 回文子串长度为偶数
        l = i;
        r = i + 1;
        while (l >= 0 && r < s.length() && s[l] == s[r]) {
            l--;
            r++;
        }
        if (ans.length() < r - l - 1) {
            ans = s.substr(l + 1, r - l - 1);
        }
    }
    return ans;
}

// 动态规划法
string longestPalindromeDP(string s) {
    if (s.empty()) {
        return "";
    }
    int n = s.length();
    int left = 0; // 最长回文串的起点
    int right = 0; // 最长回文串的重点
    int len = 0; // 最长回文串的长度

    // dp[i][j]表示从[i,j]的回文串长度
    // 可推出dp[i][i]表示长度为1的回文串
    vector<vector<int>> dp(n, vector<int>(n, 0));

    for (int i = 0; i < n; ++i) {
        dp[i][i] = 1; // 回文串长度为1
        for (int j = 0; j < i; ++j) {
            // [j,i]是否回文串的判断条件
            // 1. s[i] == s[j]
            // 2. [j,i]之间长度为1 或 dp[j+1][i-1]为回文
            dp[j][i] = (s[i] == s[j]) && (i - j < 2 || dp[j+1][i-1]);
            if (dp[j][i] && len < i - j + 1) {
                len = i-j+1;
                left = j;
                right = i;
            }
        }
    }
    return s.substr(left, right-left+1);
}

void testcase1()
{
    string s = "babad";
//    string ret = longestPalindrome(s);
    string ret = longestPalindromeDP(s);
    printf("ret = %s\n", ret.c_str());
}

int main()
{
    printf("xxx\n");
    testcase1();
    return 0;
}
