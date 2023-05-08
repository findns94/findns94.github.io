//
// Created by FindNS on 2022/4/12.
//

#include "string_common.h"

int lengthOfLongestSubstring(string s) {
    // 每个字符上次出现的位置
    vector<int> pos(128, -1);
    int ans = 0;
    for (int i = 0, j = 0; i < s.length(); ++i) {
        // 左边界为上次出现的位置+1
        j = max(j, pos[s[i]] + 1);
        ans = max(ans, i - j + 1);
        pos[s[i]] = i;
//        printf("s[%c] = %d\n", s[i], i);
    }
    return ans;
}

void testcase1()
{
    string s = "abcabcbb";
    int ret = lengthOfLongestSubstring(s);
    printf("ret = %d\n", ret);
}

int main()
{
    printf("xxx\n");
    testcase1();
    return 0;
}