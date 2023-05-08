//
// Created by FindNS on 2022/3/13.
//

#include "sort_common.h"

// https://leetcode-cn.com/problems/sort-an-array/
// 带随机选择pivot的快速排序
// 时间复杂度期望O(nlogn)
// 空间复杂度O(h),h为递归调用的层数
// 最坏情况下需 O(n) 的空间，最优情况下每次都平衡，
// 此时整个递归树高度为logn，空间复杂度为O(logn)。
int partition(vector<int> &nums, int left, int right) {
    int i = left - 1;
    for (int j = left; j < right; ++j) {
        if (nums[j] <= nums[right]) {
            ++i;
            swap(nums[i], nums[j]);
        }
    }
    swap(nums[i+1], nums[right]);
    return i + 1;
}

int rand_partition(vector<int> &nums, int left, int right) {
    int i = rand() % (right - left + 1) + left;
    swap(nums[right], nums[i]);
    return partition(nums, left, right);
}

void quickSort(vector<int> &nums, int left, int right) {
    if (left < right) {
        int i = rand_partition(nums, left, right);
        quickSort(nums, left, i - 1);
        quickSort(nums, i + 1, right);
    }
}

vector<int> sortArray(vector<int>& nums) {
    srand((unsigned)time(NULL));
    quickSort(nums, 0, nums.size() - 1);
    return nums;
}
//    sort(nums.begin(), nums.end());

// 堆排序
// 时间复杂度O(nlogn)
// 空间复杂度O(1)
int heapSize;

int left(int i) {
    return (i << 1) + 1; // 下标left = i * 2 + 1
}

int right(int i) {
    return (i << 1) + 2; // 下标right = i * 2 + 2
}

void maxHeapify(vector<int> &nums, int i)
{
    int largest = i;
    int l = left(largest);
    int r = right(largest);
    if (l < heapSize && nums[l] > nums[largest]) { // 此处heapSize动态变化
        largest = l;
    }
    if (r < heapSize && nums[r] > nums[largest]) {
        largest = r;
    }
    if (largest != i) {
        swap(nums[i], nums[largest]);
        maxHeapify(nums, largest); // 此处递归有栈溢出风险,可转化为循环
        // https://leetcode-cn.com/problems/sort-an-array/solution/pai-xu-shu-zu-by-leetcode-solution/
    }
}

void buildMaxHeap(vector<int> &nums)
{
    heapSize = nums.size();
    // 从n/2-1个元素开始构建大顶堆
    for (int i = (heapSize >> 1) - 1; i >= 0; --i) {
        maxHeapify(nums, i);
    }
}

vector<int> sortArray2(vector<int>& nums) {
    int n = nums.size();
    buildMaxHeap(nums);
    for (int i = 0; i < n; ++i) {
        swap(nums[0], nums[--heapSize]); // 把最大值交换到heapSize位置
        maxHeapify(nums, 0); // 从头调整大顶堆
    }
    return nums;
}

vector<int> temp;

// 归并排序
// 时间复杂度
void merge(vector<int> &nums, int low, int mid, int high)
{
    // nums[low...mid] 和 nums[mid+1...high]分别有序,归并为[low...high]
    // 使用临时数组O(n)
    int k = low;
    int i = low;
    int j = mid + 1;
    // 复制nums[low,high]到临时数组
    for (int m = low; m <= high; ++m) {
        temp[m] = nums[m];
    }
    // 归并temp[low...mid] 和 temp[mid+1...high] 到 nums[low, high]
    while (i <= mid && j <= high) {
        if (temp[i] < temp[j]) {
            nums[k++] = temp[i++];
        } else {
            nums[k++] = temp[j++];
        }
    }
    // 处理temp[low...mid] 或 temp[mid+1...high] 未归并的部分
    while (i <= mid) {
        nums[k++] = temp[i++];
    }
    while (j <= high) {
        nums[k++] = temp[j++];
    }
}

void mergeSort(vector<int> &nums, int l, int r)
{
    if (l < r) {
        int mid = (l + r) / 2;
        mergeSort(nums, l, mid);
        mergeSort(nums, mid + 1, r);
        merge(nums, l, mid, r);
    }
}

vector<int> sortArray3(vector<int> &nums)
{
    int n = nums.size();
    // 归并排序申请额外空间
    temp.resize(n, 0);
    mergeSort(nums, 0, n - 1);
    return nums;
}

void testcase()
{
    vector<int> nums = {5,1,1,2,0,0};
//    vector<int> nums = {1,3,5,7,2,6,4,8,9,2,8,7,6,0,3,5,9,4,1,0};
//    vector<int> ans = sortArray(nums);
    vector<int> ans = sortArray2(nums);
    for (auto c : ans) {
        printf("%d\n", c);
    }
}

void testcase2()
{
    vector<int> nums = {5,1,1,2,0,0};
    vector<int> ans = sortArray3(nums);
    for (auto c : ans) {
        printf("%d\n", c);
    }
}

int main()
{
    printf("xxx\n");
//    testcase();
    testcase2();
    return 0;
}
