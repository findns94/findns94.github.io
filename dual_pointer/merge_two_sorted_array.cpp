//
// Created by FindNS on 2022/3/12.
//

#include "dual_common.h"

// nums_1 = {1,2,3,0,0,0}
// nums_2 = {2,5,6}
// ans    = {1,2,2,3,5,6}

// 思路:逆向思考,不要忽略nums2不为空的情况
void merge(vector<int> &nums1, int m, vector<int> &nums2, int n)
{
    int end = m + n - 1;
    m--;
    n--;
    while (m >= 0 && n >= 0) {
        if (nums1[m] > nums2[n]) {
            nums1[end--] = nums1[m--];
        } else {
            nums1[end--] = nums2[n--];
        }
    }
    while (n >= 0) {
        nums1[end--] = nums2[n--];
    }
}

void testcase()
{
    vector<int> nums_1 = {1,2,3,0,0,0};
    int m = 3;
    vector<int> nums_2 = {2,5,6};
    int n = 3;

    printf("yyy\n");
    merge(nums_1, m, nums_2, n);
    printf("===\n");
    for (auto n : nums_1) {
        printf("%d\n", n);
    }
    printf("zzz\n");
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}
