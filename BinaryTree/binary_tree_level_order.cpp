//
// Created by FindNS on 2022/3/12.
//

#include "tree_common.h"

// 二叉树层序遍历
vector<vector<int>> levelOrder(TreeNode* root) {
    if (!root) {
        return {};
    }
    vector<vector<int>> ans;
    queue<TreeNode *> q;
    q.push(root);
    while (!q.empty()) {
        int count = q.size();
        vector<int> level;
        for (int i = 0; i < count; ++i) {
            TreeNode *node = q.front();
            q.pop();
            level.push_back(node->val);
            if (node->left) {
                q.push(node->left);
            }
            if (node->right) {
                q.push(node->right);
            }
        }
        ans.push_back(level);
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

    vector<vector<int>> ans = levelOrder(root);
    for (vector<int> level : ans) {
        for (auto c : level) {
            printf("%d ", c);
        }
        printf("\n");
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
