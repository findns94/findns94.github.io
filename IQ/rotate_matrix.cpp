//
// Created by FindNS on 2022/3/23.
//

#include "iq_common.h"

// https://leetcode-cn.com/problems/rotate-matrix-lcci/

void rotate(vector<vector<int>>& matrix) {
    int n = matrix.size();
    vector<vector<int>> m = matrix;
    for (int i = 0; i < n; ++i) {
        for (int j = 0; j < n; ++j) {
            m[j][n - i - 1] = matrix[i][j];
        }
    }
    matrix = m;
}

void rotate_swap_inplace(vector<vector<int>>& matrix) {
    int n = matrix.size();
    for (int i = 0; i < n / 2; ++i) {
        for (int j = 0; j < (n + 1) / 2; ++j) {
            int temp = matrix[i][j];
            matrix[i    ][j    ] = matrix[n-j-1][i    ];
            matrix[n-j-1][i    ] = matrix[n-i-1][n-j-1];
            matrix[n-i-1][n-j-1] = matrix[j]    [n-i-1];
            matrix[j    ][n-i-1] = temp;
        }
    }
}

void rotate_inplace(vector<vector<int>>& matrix) {
    int n = matrix.size();
    for (int i = 0; i < n / 2; ++i) {
        for (int j = 0; j < n; ++j) {
            swap(matrix[i][j], matrix[n-i-1][j]);
        }
    }
    for (int i = 0; i < n; ++i) {
        for (int j = 0; j < i; ++j) {
            swap(matrix[i][j], matrix[j][i]);
        }
    }
}

void testcase1()
{
    vector<vector<int>> m = {
        {1,2,3},
        {4,5,6},
        {7,8,9},
    };
//    rotate(m);
    rotate_swap_inplace(m);
//    rotate_inplace(m);
    for (auto a : m) {
        for (auto b : a) {
            printf("%d ", b);
        }
        printf("\n");
    }
}

int main()
{
    printf("xxx\n");
    testcase1();
    return 0;
}
