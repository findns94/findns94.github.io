//
// Created by FindNS on 2022/3/22.
//

#include "tree_common.h"

struct TrieNode {
    TrieNode *childNode[26];
    bool isVal;
    TrieNode() : isVal(false) {
        for (int i = 0; i < 26; ++i) {
            childNode[i] = nullptr;
        }
    }
};

class Trie {
    TrieNode *root;
public:
    Trie() {
        root = new TrieNode();
    }

    void insert(string word) {
        TrieNode *temp = root;
        for (int i = 0; i < word.size(); ++i) {
            int j = word[i] - 'a';
            if (!temp->childNode[j]) {
                temp->childNode[j] = new TrieNode;
            }
            temp = temp->childNode[j];
        }
        temp->isVal = true;
    }

    bool search(string word) {
        TrieNode *temp = root;
        for (int i = 0; i < word.size(); ++i) {
            if (!temp) {
                break;
            }
            int j = word[i] - 'a';
            temp = temp->childNode[j];
        }
        if (temp) {
            return temp->isVal;
        } else {
            return false;
        }
    }

    bool startsWith(string prefix) {
        TrieNode *temp = root;
        for (int i = 0; i < prefix.size(); ++i) {
            if (!temp) {
                break;
            }
            int j = prefix[i] - 'a';
            temp = temp->childNode[j];
        }
        return temp;
    }
};

void testcase1()
{
    bool ret;
    Trie *trie = new Trie();
    trie->insert("apple");
    ret = trie->search("apple");   // 返回 True
    printf("ret = %d\n", ret);
    ret = trie->search("app");     // 返回 False
    printf("ret = %d\n", ret);
    ret = trie->startsWith("app"); // 返回 True
    printf("ret = %d\n", ret);
    trie->insert("app");
    ret = trie->search("app");     // 返回 True
    printf("ret = %d\n", ret);
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
