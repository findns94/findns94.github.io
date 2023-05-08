//
// Created by FindNS on 2022/3/1.
//

#include "tree_common.h"

// 判断一个二叉树是否平衡。树平衡的定义是，对于树上的任意节点，其两侧节点的最大深度
// 的差值不得大于 1。
// 思路: 递归，二叉树最大深度变体

int helper(TreeNode *root)
{
    if (!root) {
        return 0;
    }
    int left  = helper(root->left);
    int right = helper(root->right);
    if (left == -1 || right == -1 || abs(left-right) > 1) {
        return -1;
    }
    return 1 + max(left, right);
}

int isBalanced(TreeNode *root)
{
    return helper(root) != -1;
}

void testcase1()
{
    TreeNode *root     = new TreeNode(3);
    root->left         = new TreeNode(9);
    root->right        = new TreeNode(20);
    root->right->left  = new TreeNode(15);
    root->right->right = new TreeNode(7);
    int flag = isBalanced(root);
    printf("isBalanced = %d\n", flag);
}

void testcase2()
{
    TreeNode *root          = new TreeNode(1);
    root->left              = new TreeNode(2);
    root->right             = new TreeNode(2);
    root->left->left        = new TreeNode(3);
    root->left->right       = new TreeNode(3);
    root->left->left->left  = new TreeNode(4);
    root->left->left->right = new TreeNode(4);
    int flag = isBalanced(root);
    printf("isBalanced = %d\n", flag);
}

int main()
{
    testcase1();
    testcase2();
    return 0;
}
