//
// Created by FindNS on 2022/3/12.
//

#include "tree_common.h"

// 二叉树2个节点的最近公共祖先
// 思路: 递归
// 当我们用递归去做这个题时不要被题目误导，应该要明确一点
// 这个函数的功能有三个：给定两个节点 p 和 q
//
// 如果 p 和 q 都存在，则返回它们的公共祖先；
// 如果只存在一个，则返回存在的一个；
// 如果 p 和 q 都不存在，则返回NULL
// 本题说给定的两个节点都存在，那自然还是能用上面的函数来解决
//
// 具体思路：
// （1） 如果当前结点 root 等于 NULL，则直接返回 NULL
// （2） 如果 root 等于 p 或者 q ，那这棵树一定返回 p 或者 q
// （3） 然后递归左右子树，因为是递归，使用函数后可认为左右子树已经算出结果，用 left 和 right 表示
// （4） 此时若left为空，那最终结果只要看 right；若 right 为空，那最终结果只要看 left
// （5） 如果 left 和 right 都非空，因为只给了 p 和 q 两个结点，都非空，说明一边一个，因此 root 是他们的最近公共祖先
// （6） 如果 left 和 right 都为空，则返回空（其实已经包含在前面的情况中了）
//
// 时间复杂度是 O(n)：每个结点最多遍历一次或用主定理，空间复杂度是 O(n)：需要系统栈空间
//
// 链接：https://leetcode-cn.com/problems/lowest-common-ancestor-of-a-binary-tree/solution/c-jing-dian-di-gui-si-lu-fei-chang-hao-li-jie-shi-/


TreeNode *lowestCommonAncestor(TreeNode *root, TreeNode *p, TreeNode *q)
{
    if (root == nullptr) {
        return nullptr;
    }
    if (root == p || root == q) {
        return root;
    }
    TreeNode *left  = lowestCommonAncestor(root->left , p, q);
    TreeNode *right = lowestCommonAncestor(root->right, p, q);
    if (left == nullptr) {
        return right;
    }
    if (right == nullptr) {
        return left;
    }
    if (left && right) {
        return root;
    }
    return nullptr;
}

void testcase()
{
    TreeNode *root           = new TreeNode(3);
    root->left               = new TreeNode(5);
    root->right              = new TreeNode(1);
    root->left->left         = new TreeNode(6);
    root->left->right        = new TreeNode(2);
    root->left->right->left  = new TreeNode(7);
    root->left->right->right = new TreeNode(4);
    root->right->left        = new TreeNode(0);
    root->right->right       = new TreeNode(8);

    TreeNode *p = root->left;
    TreeNode *q = root->left->right->right;

    TreeNode *ancestor = lowestCommonAncestor(root, p, q);
    printf("ancestor = %d\n", ancestor->val);
}

int main()
{
    testcase();
    return 0;
}
