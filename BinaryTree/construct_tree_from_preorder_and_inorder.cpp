//
// Created by FindNS on 2022/3/9.
//

#include "tree_common.h"

// 输入是两个一维数组，分别表示树的前序遍历和中序遍历结果；输出是一个二叉树。
// Input: preorder = [4,9,20,15,7], inorder = [9,4,15,20,7]
// Output:
//      4
//     / \
//    9   20
//   / \
//  15  7

// 思路: 递归，确定根节点，根据前序和中序遍历性质处理
// 用哈希表预处理中序遍历的结果
// LeetCode 101 上解法不直观，参考acwing的解法
// https://www.acwing.com/blog/content/3919/

/*
TreeNode* helper(unordered_map<int, int> &hash, vector<int> &preorder, int s0, int e0, int s1)
{
    if (s0 > e0) {
        return nullptr;
    }
    int mid = preorder[s1];
    int index = hash[mid];
    int leftLen = index - s0 - 1;
    TreeNode *node = new TreeNode(mid);
    node->left  = helper(hash, preorder, s0, index - 1, s1 + 1);
    node->right = helper(hash, preorder, index + 1, e0, s1 + 2 + leftLen);
    return node;
}

TreeNode* buildTree(vector<int> &preorder, vector<int> &inorder)
{
    if (preorder.empty()) {
        return nullptr;
    }
    unordered_map<int, int> hash;
    for (int i = 0; i < preorder.size(); ++i) {
        hash[inorder[i]] = i;
    }
    return helper(hash, preorder, 0, preorder.size() - 1, 0);
}
*/

unordered_map<int, int> m;
int index;

TreeNode *helper(vector<int> &preorder, int start, int end)
{
    if (start > end) {
        return nullptr;
    }
    int mid = m[preorder[index]]; // mid为中序遍历数组此次root下标
    TreeNode *root = new TreeNode(preorder[index]);
    index++; // 前序遍历下标自增,寻找下一个root节点
    root->left  = helper(preorder, start, mid - 1); // 中序遍历左子树[start, mid-1]
    root->right = helper(preorder, mid + 1, end);  // 中序遍历右子树[mid+1, end]
    return root;
}

TreeNode* buildTree(vector<int> &preorder, vector<int> &inorder)
{
    if (preorder.empty()) {
        return nullptr;
    }
    int n = inorder.size();
    for (int i = 0; i < n; ++i) {
        m[inorder[i]] = i;
    }
    index = 0;
    return helper(preorder, 0, n - 1);
}

void testcase1()
{
    vector<int> preorder_nums = {4,9,20,15,7};
    vector<int> inorder_nums  = {9,4,15,20,7};

    printf("xxx\n");
    TreeNode *root = buildTree(preorder_nums, inorder_nums);
    printf("yyy\n");
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
