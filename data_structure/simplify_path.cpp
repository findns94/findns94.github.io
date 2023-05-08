//
// Created by FindNS on 2022/3/23.
//

#include "data_common.h"

// 简化路径
// https://leetcode-cn.com/problems/simplify-path/
// https://leetcode-cn.com/problems/simplify-path/solution/71-jian-hua-lu-jing-li-yong-zhan-zhu-shi-7nzz/
string simplifyPath(string path) {
    int n = path.size();
    int i = 0;
    vector<string> s; // vector模拟栈
    string temp; // 每次取出的合法子路径
    string ans = ""; // 简化后的路径
    while (i < n) {
        //遇到 "/" 一直往后，直到非斜杠
        if (path[i] == '/') {
            i++;
        } else {
            // temp置空，用于存储下一个文件名
            temp = "";
            //将两斜杠间的字符组成串，再进行判断
            for (; i< n && path[i] != '/'; ++i) {
                temp += path[i];
            }
            if (temp == ".") {
                //当前目录，什么都不做
            } else if (temp == "..") {
                //返回上级目录（弹出栈顶元素）
                if (!s.empty()) {
                    s.pop_back();
                }
            } else {
                //其余情况都认为是文件或目录名
                s.push_back(temp);
            }
        }
    }
    //栈为空表示仍在根目录
    if (s.empty()) {
        return "/";
    }
    for (auto t : s) {
        // 注意补'/'
        ans += ("/" + t);
    }
    return ans;
}

void testcase()
{
    string path = "/a/./b/../../c/";
    string ans = simplifyPath(path);
    printf("%s\n", ans.c_str());
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}
