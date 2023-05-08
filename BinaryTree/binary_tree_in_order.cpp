//
// Created by FindNS on 2022/3/12.
//

#include "tree_common.h"

// 二叉树中序遍历
void inorder(TreeNode *root, vector<int> &ans)
{
    if (!root) {
        return;
    }
    inorder(root->left, ans);
    ans.push_back(root->val);
    inorder(root->right, ans);
}

// 递归版本
vector<int> inorderTraversal(TreeNode* root)
{
    vector<int> ans;
    inorder(root, ans);
    return ans;
}

vector<int> preorderNonRecursive(TreeNode *root)
{
    if (!root) {
        return {};
    }
    vector<int> ans;
    stack<TreeNode *> s;
    while (root || !s.empty()) {
        while (root) {
            ans.push_back(root->val); // 先序遍历
            s.push(root);
            root = root->left;
        }
        root = s.top();
        s.pop();
        root = root->right;
    }
    return ans;
}

// 非递归版本
vector<int> inorderNonRecursive(TreeNode *root)
{
    if (!root) {
        return {};
    }
    vector<int> ans;
    stack<TreeNode *> s;
    while (root || !s.empty()) {
        while (root) {
            s.push(root);
            root = root->left;
        }
        root = s.top();
        s.pop();
        ans.push_back(root->val); // 中序遍历
        root = root->right;
    }
    return ans;
}

vector<int> postorderNonRecursive(TreeNode *root)
{
    if (!root) {
        return {};
    }
    vector<int> ans;
    stack<TreeNode *> s;
    TreeNode *prev = nullptr;
    while (root || !s.empty()) {
        while (root) {
            s.push(root);
            root = root->left;
        }
        root = s.top();
        if (root->right != nullptr && root->right != prev) {
            root = root->right;
        } else {
            s.pop();
            ans.push_back(root->val); // 后序遍历
            prev = root;
            root = nullptr;
        }
    }
    return ans;
}


void testcase1()
{
    TreeNode *root     = new TreeNode(3);
    root->left         = new TreeNode(9);
    root->right        = new TreeNode(20);
    root->right->left  = new TreeNode(15);
    root->right->right = new TreeNode(7);

//    vector<int> ans = inorderTraversal(root);
    vector<int> ans = inorderNonRecursive(root);
    for (auto c : ans) {
        printf("%d\n", c);
    }
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
