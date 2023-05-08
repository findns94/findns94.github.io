//
// Created by FindNS on 2022/3/30.
//

#include "binary_common.h"

// 旋转有序数组查找
// https://leetcode-cn.com/problems/search-in-rotated-sorted-array-ii/?utm_source=LCUS&utm_medium=ip_redirect&utm_campaign=transfer2china

bool searchMatrix(vector<vector<int>> &matrix, int target)
{
    if (matrix.size() == 0 || matrix[0].size() == 0) {
        return false;
    }
    int m = matrix.size();
    int n = matrix[0].size();
    int row = 0;
    int col = n - 1;
    while (row < m && col >= 0) {
        if (target > matrix[row][col]) {
            row++;
        } else if (target < matrix[row][col]) {
            col--;
        } else {
            return true;
        }
    }
    return false;
}

void testcase1()
{
    vector<vector<int>> nums = {{1,4,7,11,15},
                                {2,5,8,12,19},
                                {3,6,9,16,22},
                                {10,13,14,17,24},
                                {18,21,23,26,30}};
    int target = 5;
    int ret = searchMatrix(nums, target);
    printf("ret = %d\n", ret);
}

void testcase2()
{
    vector<vector<int>> nums = {{1,4,7,11,15},
                                {2,5,8,12,19},
                                {3,6,9,16,22},
                                {10,13,14,17,24},
                                {18,21,23,26,30}};
    int target = 20;
    int ret = searchMatrix(nums, target);
    printf("ret = %d\n", ret);
}

int main()
{
    printf("xxx\n");
    testcase1();
    printf("yyy\n");
    testcase2();
    return 0;
}
