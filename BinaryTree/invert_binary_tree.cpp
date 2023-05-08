//
// Created by FindNS on 2022/3/9.
//

#include "tree_common.h"

// 翻转二叉树

// 1.递归
TreeNode* invertTree(TreeNode *root)
{
    if (!root) {
        return nullptr;
    }
    TreeNode *temp = root->left;
    root->left     = invertTree(root->right);
    root->right    = invertTree(temp);
    return root;
}

// 2.非递归
TreeNode* invertTreeNoneRecursive(TreeNode *root)
{
    if (!root) {
        return nullptr;
    }
    queue<TreeNode *> q;
    q.push(root);
    while (!q.empty()) {
        TreeNode *node = q.front();
        q.pop();
        TreeNode *temp = node->left;
        node->left     = node->right;
        node->right    = temp;
        if (node->left) {
            q.push(node->left);
        }
        if (node->right) {
            q.push(node->right);
        }
    }
    return root;
}

void testcase1()
{
    TreeNode *root     = new TreeNode(4);
    root->left         = new TreeNode(2);
    root->right        = new TreeNode(7);
    root->left->left   = new TreeNode(1);
    root->left->right  = new TreeNode(3);
    root->right->left  = new TreeNode(6);
    root->right->right = new TreeNode(9);
    printf("xxx\n");
    preorder(root);
    printf("yyy\n");
//    root = invertTree(root);
    root = invertTreeNoneRecursive(root);
    preorder(root);
    printf("zzz\n");
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
