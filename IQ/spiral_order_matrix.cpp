//
// Created by FindNS on 2022/4/28.
//

#include "iq_common.h"

// https://leetcode-cn.com/problems/spiral-matrix/
// 螺旋打印矩阵

vector<int> spiralOrder(vector<vector<int>>& matrix) {
    vector<int> ans;
    if (matrix.empty()) {
        return ans;
    }
    int up = 0; // 上下左右边界
    int down = matrix.size() - 1;
    int left = 0;
    int right = matrix[0].size() - 1;
    while (true) {
        // 在up行向右移动
        for (int i = left; i <= right; ++i) {
            ans.push_back(matrix[up][i]);
        }
        if (++up > down) {
            break;
        }
        for (int i = up; i <= down; ++i) {
            ans.push_back(matrix[i][right]);
        }
        if (--right < left) {
            break;
        }
        for (int i = right; i >= left; --i) {
            ans.push_back(matrix[down][i]);
        }
        if (--down < up) {
            break;
        }
        for (int i = down; i >= up; --i) {
            ans.push_back(matrix[i][left]);
        }
        if (++left > right) {
            break;
        }
    }
    return ans;
}

void testcase1()
{
    vector<vector<int>> m = {
            {1,2,3},
            {4,5,6},
            {7,8,9},
    };
    vector<int> ans = spiralOrder(m);
    for (auto a : ans) {
        printf("%d\n", a);
    }
}

int main()
{
    printf("xxx\n");
    testcase1();
    return 0;
}

