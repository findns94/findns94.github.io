//
// Created by FindNS on 2022/3/3.
//

#include "tree_common.h"

// 求一个二叉树的最长直径。直径的定义是二叉树上任意两节点之间的无向距离。
// Input:
//   1
//  / \
//  2 3
// / \
// 4  5
// Output: 3
// 思路: 递归，处理某个子树时，我们更新的
// 最长直径值和递归返回的值是不同的

int helper(TreeNode *root, int &diameter)
{
    if (!root) {
        return 0;
    }
    int left  = helper(root->left , diameter);
    int right = helper(root->right, diameter);
    diameter = max(left + right, diameter);
    return max(left, right) + 1;
}

int diameterOfBinarytree(TreeNode *root)
{
    int diameter = 0;
    helper(root, diameter);
    return diameter;
}

void testcase1()
{
    TreeNode *root    = new TreeNode(1);
    root->left        = new TreeNode(2);
    root->right       = new TreeNode(3);
    root->left->left  = new TreeNode(4);
    root->left->right = new TreeNode(5);
    int flag = diameterOfBinarytree(root);
    printf("diameterOfBinarytree = %d\n", flag);
}

//void testcase2()
//{
//    TreeNode *root          = new TreeNode(1);
//    root->left              = new TreeNode(2);
//    root->right             = new TreeNode(2);
//    root->left->left        = new TreeNode(3);
//    root->left->right       = new TreeNode(3);
//    root->left->left->left  = new TreeNode(4);
//    root->left->left->right = new TreeNode(4);
//    int flag = isBalanced(root);
//    printf("isBalanced = %d\n", flag);
//}

int main()
{
    testcase1();
//    testcase2();
    return 0;
}
