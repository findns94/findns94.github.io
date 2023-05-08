//
// Created by FindNS on 2022/3/1.
//

#ifndef LEETCODE_TREE_COMMON_H
#define LEETCODE_TREE_COMMON_H

#include <stdio.h>
#include <vector>
#include <queue>
#include <stack>
#include <set>
#include <map>
#include <unordered_set>
#include <unordered_map>
#include <algorithm>

using namespace std;

struct TreeNode {
    int val;
    TreeNode *left;
    TreeNode *right;
    TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
};

void preorder(TreeNode *root)
{
    if (!root) {
        return;
    }
    printf("%d\n", root->val);
    preorder(root->left);
    preorder(root->right);
}

#endif //LEETCODE_TREE_COMMON_H
