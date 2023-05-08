//
// Created by FindNS on 2022/3/1.
//

#include "tree_common.h"

// 求一个二叉树的最大深度
// 思路: 递归

int maxDepth(TreeNode *root)
{
    if (!root) {
        return 0;
    } else {
        return 1 + max(maxDepth(root->left), maxDepth(root->right));
    }
}

void testcase()
{
    TreeNode *root     = new TreeNode(3);
    root->left         = new TreeNode(9);
    root->right        = new TreeNode(20);
    root->right->left  = new TreeNode(15);
    root->right->right = new TreeNode(7);
    int depth = maxDepth(root);
    printf("depth = %d\n", depth);
}

int main()
{
    testcase();
    return 0;
}