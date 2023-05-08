//
// Created by FindNS on 2022/3/12.
//

#include "tree_common.h"

// 输入是两个一维数组，分别表示树的前序遍历和中序遍历结果；输出是一个二叉树。
// Input: inorder = [9,3,15,20,7], postorder = [9,5,7,20,3],
// Output:
//      3
//     / \
//    9   20
//        / \
//       15  7

// 思路: 递归，确定根节点，根据中序和后序遍历性质处理
// 用哈希表预处理中序遍历的结果
// LeetCode 101 上解法不直观，参考acwing的解法
// https://www.acwing.com/blog/content/3919/

unordered_map<int, int> m;
int index;

TreeNode *helper(vector<int> &postorder, int start, int end)
{
    if (start > end) {
        return nullptr;
    }
    int mid = m[postorder[index]]; // mid为中序遍历数组此次root下标
    TreeNode *root = new TreeNode(postorder[index]);
    index--; // 前序遍历下标自减,寻找下一个root节点
    root->right = helper(postorder, mid + 1, end);  // 先递归右子树,中序遍历右子树[mid+1, end]
    root->left  = helper(postorder, start, mid - 1); // 中序遍历左子树[start, mid-1]
    return root;
}

TreeNode* buildTree(vector<int> &inorder, vector<int> &postorder)
{
    if (postorder.empty()) {
        return nullptr;
    }
    int n = inorder.size();
    for (int i = 0; i < n; ++i) {
        m[inorder[i]] = i;
    }
    index = n - 1;
    return helper(postorder, 0, n - 1);
}

void testcase1()
{
    vector<int> inorder_nums   = {9,3,15,20,7};
    vector<int> postorder_nums = {9,15,7,20,3};

    printf("xxx\n");
    TreeNode *root = buildTree(inorder_nums, postorder_nums);
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
