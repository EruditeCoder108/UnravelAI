let result = 0;

function calculate(values) {
    let result = 0;

    function accumulate(items) {
        let result = 0;
        items.forEach(item => {
            result += item.value;
        });
        return result;
    }

    result = accumulate(values);
    return result;
}

function getResult() {
    return result;
}

calculate([{ value: 10 }, { value: 20 }]);
console.log(getResult());
