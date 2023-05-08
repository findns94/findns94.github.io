//
// Created by FindNS on 2022/3/3.
//

#include "tree_common.h"

// 给定一个整数二叉树，求有多少条路径节点值的和等于给定值。
// IInput: sum = 8, tree =
//      10
//     / \
//     5 -3
//    / \ \
//    3 2  11
//   / \ \
//   3 -2 1
// Output: 3
// 思路: 递归
// （1）如果选取该节点加入路径，则之后必须继续加入连续节点，或停止加入节点
// （2）如果不选取该节点加入路径，则对其左右节点进行重新进行考虑

bool isSymmetric(TreeNode *left, TreeNode *right)
{
    if (!left && !right) {
        return true;
    }
    if (!left || !right) {
        return false;
    }
    if (left->val != right->val) {
        return false;
    }
    return isSymmetric(left->left , right->right) && \
           isSymmetric(left->right, right->left);
}

bool isSymmetric(TreeNode *root)
{
    if (root) {
        return isSymmetric(root->left, root->right);
    } else {
        return true;
    }
}

void testcase1()
{
    TreeNode *root     = new TreeNode(1);
    root->left         = new TreeNode(2);
    root->right        = new TreeNode(2);
    root->left->left   = new TreeNode(3);
    root->left->right  = new TreeNode(4);
    root->right->left  = new TreeNode(4);
    root->right->right = new TreeNode(3);

    int flag = isSymmetric(root);
    printf("isSymmetric = %d\n", flag);
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
