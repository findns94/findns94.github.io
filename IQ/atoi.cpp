//
// Created by FindNS on 2022/3/21.
//

#include "iq_common.h"

string state = "start";
int sign = 1;
long long ans = 0;

unordered_map<string, vector<string>> table = {
    {"start"    , {"start", "signed", "in_number", "end"}},
    {"signed"   , {"end"  , "end"   , "in_number", "end"}},
    {"in_number", {"end"  , "end"   , "in_number", "end"}},
    {"end"      , {"end"  , "end"   , "end"      , "end"}},
};

int get_col(char c)
{
    if (isspace(c)) {
        return 0;
    }
    if (c == '+' || c == '-') {
        return 1;
    }
    if (isdigit(c)) {
        return 2;
    }
    return 3;
}

void getInput(char c)
{
    state = table[state][get_col(c)];
    if (state == "in_number") {
        ans = ans * 10 + (c - '0');
        if (sign == 1) {
            ans = min(ans, (long long)INT_MAX);
        } else {
            ans = min(ans, -(long long)INT_MIN);
        }
    } else if (state == "signed") {
        if (c == '+') {
            sign = 1;
        } else {
            sign = -1;
        }
    }
}

int myAtoi(string s)
{
    for (char c : s) {
        getInput(c);
    }
    return sign * ans;
}

void testcase1()
{
    int ret = myAtoi("-123");
    printf("%d\n", ret);
}

int main()
{
    printf("xxx\n");
    testcase1();
    return 0;
}
