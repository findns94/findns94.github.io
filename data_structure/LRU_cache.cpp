//
// Created by FindNS on 2022/3/13.
//

#include "data_common.h"

// 题解1:https://leetcode-cn.com/problems/lru-cache/solution/lru-ce-lue-xiang-jie-he-shi-xian-by-labuladong/
// 题解2:https://www.cnblogs.com/grandyang/p/4587511.html
// file:///D:/Projects/C/Codes/doc/LeetCode%20101%20-%20A%20LeetCode%20Grinding%20Guide%20(C++%20Version).pdf

class LRUCache1 {
    unordered_map<int, list<pair<int, int>>::iterator> hashtable;
    list<pair<int, int>> cache;
    int size;

public:
    LRUCache1(int capacity) {
        size = capacity;
    }

    int get(int key) {
        auto it = hashtable.find(key);
        if (it == hashtable.end()) {
            return -1;
        }
        cache.splice(cache.begin(), cache, it->second);
        return it->second->second;
    }

    void put(int key, int value) {
        auto it = hashtable.find(key);
        if (it != hashtable.end()) {
            it->second->second = value;
            return cache.splice(cache.begin(), cache, it->second);
        }
        cache.insert(cache.begin(), make_pair(key, value));
        hashtable[key] = cache.begin();
        if (cache.size() > size) {
            hashtable.erase(cache.back().first);
            cache.pop_back();
        }
    }
};

class LRUCache {
    int cacheSize;
    list<pair<int, int>> cache; // (key,value)对链表
    unordered_map<int, list<pair<int, int>>::iterator> m;
    // key -> key在cache链表的迭代器(下标)

public:
    LRUCache(int capacity) {
        cacheSize = capacity;
    }

    int get(int key) {
        auto it = m.find(key);
        // 若key不存在,返回-1
        if (it == m.end()) {
            return -1;
        } else {
            // 若key存在,将(key,value)提到cache链表头,返回value
            // it->second是迭代器
            cache.splice(cache.begin(), cache, it->second);
            return it->second->second;
        }
    }

    void put(int key, int value) {
        // 若key存在,则无需担心超过capacity
        auto it = m.find(key);
        if (it != m.end()) {
            // 删除原来的(key,value)下标
            cache.erase(it->second);
        }
        // 将(key,value)加到cache链表头|若key不存在,将(key,value)插到到cache链表头
        cache.push_front(make_pair(key, value));
        // 更新hash表key的迭代器映射关系
        m[key] = cache.begin();
        if (m.size() > cacheSize) {
            int delKey = cache.rbegin()->first;
            // 删除链表尾部元素
            cache.pop_back();
            // 删除hash表中对链表尾部迭代器的保存
            m.erase(delKey);
        }
    }
};

// (key,value), size=3
// (1,1)<->(2,2)<->(3,3)
// get(2,2)
// (2,2)<->(1,1)<->(3,3)
// put(4,4)
// (4,4)<->(2,2)<->(1,1)

class LRUCache2 {
// 设计数据结构
// 1. Cache大小CacheSize
// 2. 双向链表,保存pair<key,value>
// 3. 指向双向链表迭代器下标的hashmap,(key,iterator)
    int cacheSize;
    list<pair<int,int>> cache;
    unordered_map<int, list<pair<int,int>>::iterator> hashmap;

public:
    LRUCache2(int capacity) {
        cacheSize = capacity;
    }

    int get(int key) {
        auto it = hashmap.find(key);
        // 通过查找hashmap的key,判断iterator是否存在,
        if (it == hashmap.end()) {
            // 1.不存在,表示cache里没有这个key,返回-1
            return -1;
        } else {
            // 2.存在,将对应的(key,value)移到cache双向链表begin位置
            int key = it->first;
            int val = it->second->second;
            cache.erase(it->second);
            cache.push_front(make_pair(key,val));
            hashmap[key] = cache.begin();
            return val;
        }

    }

    void put(int key, int value) {
        // 通过查找hashmap的key,判断iterator是否存在
        auto it = hashmap.find(key);
        if (it != hashmap.end()){
            // 先删除hashmap的key
            cache.erase(it->second);
        }
        // (key,value)加到cahce list的begin位置
        cache.push_front(make_pair(key,value));
        hashmap[key] = cache.begin();
        if (hashmap.size() > cacheSize) {
            // 若cache的size超过CacheSize,则删除cache list尾部元素,清除hashmap映射
            int delKey = cache.rbegin()->first;
            cache.pop_back();
            hashmap.erase(delKey);
        }
    }
};

void testcase()
{
//    LRUCache1 *lru = new LRUCache1(2);
    LRUCache *lru = new LRUCache(2);
    lru->put(1, 1);
    lru->put(2, 2);
    printf("%d\n", lru->get(1)); // 1
    lru->put(3, 3);
    printf("%d\n", lru->get(2)); // -1
    lru->put(4, 4);
    printf("%d\n", lru->get(1)); // -1
    printf("%d\n", lru->get(3)); // 3
    printf("%d\n", lru->get(4)); // 4
}

void testcase2()
{
//    LRUCache1 *lru = new LRUCache1(2);
    LRUCache2 *lru = new LRUCache2(2);
    lru->put(1, 1);
    lru->put(2, 2);
    printf("%d\n", lru->get(1)); // 1
    lru->put(3, 3);
    printf("%d\n", lru->get(2)); // -1
    lru->put(4, 4);
    printf("%d\n", lru->get(1)); // -1
    printf("%d\n", lru->get(3)); // 3
    printf("%d\n", lru->get(4)); // 4
}

void test_list_splice_1()
{
    list<int> l1 = {1,2};
    list<int> l2 = {3,4,5};
    l1.splice(l1.end(), l2, l2.begin(), l2.end());
    for (auto it = l1.begin(); it != l1.end(); ++it) {
        cout << *it << endl;
    }
}

// 总结：将第二个参数的list的部分(由第三个参数决定)，拼接到第一个list上(由第一个参数决定）
void test_list_splice_2()
{
    list<int> l1 = {1,2,3,4};
//    list<int> l2 = {11,12,13,14};
//    l1.splice(l1.end(), l2, l2.begin(), l2.end());
    auto itr = l1.begin(); // *it = 1
    itr++; // *it = 2
    l1.splice(l1.begin(), l1, itr);
    for (auto it = l1.begin(); it != l1.end(); ++it) {
        cout << *it << endl;
    }
}

int main()
{
    printf("xxx\n");
    testcase();
    printf("yyy\n");
    testcase2();
//    test_list_splice_1();
//    printf("===\n");
//    test_list_splice_2();
    return 0;
}
