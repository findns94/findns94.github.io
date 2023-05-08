//
// Created by FindNS on 2022/3/9.
//

#include "tree_common.h"

// 给定一个整数二叉树和一些整数，求删掉这些整数对应的节点后，剩余的子树。
// Input: to_delete = [3,5], tree =
//        1
//      /  \
//      2   3
//     / \ / \
//    4  5 6  7
// Output: [
//      1
//     /
//    2
//   /
//  4    , 6, 7 ]

// 思路: 递归处理原树，以及需要在什么时候断开指针。同时，
// 为了便于寻找待删除节点，可以建立一个哈希表方便查找

TreeNode* helper(TreeNode *root, unordered_set<int> &dict, vector<TreeNode *> &forest)
{
    if (!root) {
        return root;
    }
    root->left  = helper(root->left , dict, forest);
    root->right = helper(root->right, dict, forest);
    if (dict.count(root->val)) {
        if (root->left) {
            forest.push_back(root->left);
        }
        if (root->right) {
            forest.push_back(root->right);
        }
        root = nullptr;
    }
    return root;
}

vector<TreeNode *> delNodes(TreeNode *root, vector<int> &to_delete)
{
    vector<TreeNode *> forest;
    unordered_set<int> dict(to_delete.begin(), to_delete.end());
    root = helper(root, dict, forest);
    if (root) {
        forest.push_back(root);
    }
    return forest;
}

void testcase1()
{
    TreeNode *root     = new TreeNode(1);
    root->left         = new TreeNode(2);
    root->right        = new TreeNode(3);
    root->left->left   = new TreeNode(4);
    root->left->right  = new TreeNode(5);
    root->right->left  = new TreeNode(6);
    root->right->right = new TreeNode(7);

    printf("xxx\n");
    preorder(root);
    printf("yyy\n");
    vector<int> to_del = {3, 5};
    vector<TreeNode *> ans = delNodes(root, to_del);
    for (TreeNode *t : ans) {
        preorder(t);
        printf("aaa\n");
    }
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
