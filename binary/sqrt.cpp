//
// Created by FindNS on 2022/3/7.
//

#include "binary_common.h"

int mySqrt(int a)
{
    long x = a;
    while (x * x > a) {
        x = (x + a / x) / 2;
    }
    return x;
}

void testcase()
{
    for (int i = 0; i <= 20; ++i) {
        printf("i = %d, sqrt(i) = %d\n", i, mySqrt(i));
    }
    return;
}

int main()
{
    testcase();
    return 0;
}
