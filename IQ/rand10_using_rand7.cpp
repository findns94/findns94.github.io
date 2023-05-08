//
// Created by FindNS on 2022/3/21.
//

#include "iq_common.h"

// https://leetcode-cn.com/problems/implement-rand10-using-rand7/solution/xiang-xi-si-lu-ji-you-hua-si-lu-fen-xi-zhu-xing-ji/

int rand7()
{
    int i = rand() % 7 + 1;
    return i;
}

int rand10()
{
    int i = (rand7() - 1)* 7 + rand7();
    while (i > 10) {
        i = (rand7() - 1)* 7 + rand7();
    }
    return i;
}

void testcase1()
{
    vector<int> nums(8,0);
    for (int i = 0; i < 1000000; ++i) {
        nums[rand7()]++;
    }
    for (int i = 1; i < nums.size(); ++i) {
        printf("%d, num = %d\n", i, nums[i]);
    }
}

void testcase2()
{
    vector<int> nums(11,0);
    for (int i = 0; i < 1000000; ++i) {
        nums[rand10()]++;
    }
    for (int i = 1; i < nums.size(); ++i) {
        printf("%d, num = %d\n", i, nums[i]);
    }
}

int main()
{
    srand((unsigned)time(NULL));
    printf("xxx\n");
//    testcase1();
    testcase2();
    return 0;
}
