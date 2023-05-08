//
// Created by FindNS on 2022/3/9.
//

#include "tree_common.h"

// 给定一个二叉树，求每一层的节点值的平均数。
// Input:
//      3
//     / \
//     9 20
//    / \
//   15  7
// Output: [3, 14.5, 11]

// 思路: 利用广度优先搜索，我们可以很方便地求取每层的平均值

vector<double> averageOfLevels(TreeNode *root)
{
    vector<double> ans;
    if (!root) {
        return ans;
    }
    queue<TreeNode *> q;
    q.push(root);
    while (!q.empty()) {
        int count = q.size();
        double sum = 0;
        for (int i = 0; i < count; ++i) {
            TreeNode *node = q.front();
            q.pop();
            sum += node->val;
            if (node->left) {
                q.push(node->left);
            }
            if (node->right) {
                q.push(node->right);
            }
        }
        ans.push_back(sum / count);
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

    vector<double> ans = averageOfLevels(root);
    for (double c : ans) {
        printf("%.3f\n", c);
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
