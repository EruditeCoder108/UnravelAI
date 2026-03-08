const timerEl = document.getElementById("timer")

const startBtn = document.getElementById("start")
const pauseBtn = document.getElementById("pause")
const resetBtn = document.getElementById("reset")

const modeButtons = document.querySelectorAll(".modes button")

let duration = 25 * 60
let remaining = duration

let interval = null
let startTimestamp = null

function formatTime(sec){

    const m = Math.floor(sec / 60)
    const s = sec % 60

    return `${m}:${s < 10 ? "0"+s : s}`
}

function render(){
    timerEl.textContent = formatTime(remaining)
}

function tick(){

    const now = Date.now()

    const elapsed = Math.floor((now - startTimestamp) / 1000)

    remaining = duration - elapsed

    if(remaining <= 0){

        clearInterval(interval)

        interval = null

        timerEl.textContent = "00:00"

        alert("Session done")

        return
    }

    render()
}

function start(){

    if(interval) return

    startTimestamp = Date.now()

    interval = setInterval(tick,1000)

}

function pause(){

    if(!interval) return

    clearInterval(interval)

    interval = null

    duration = remaining

}

function reset(){

    clearInterval(interval)

    interval = null

    remaining = duration

    render()
}

function setMode(minutes){

    duration = minutes * 60

    remaining = duration

    render()

}

startBtn.addEventListener("click",start)
pauseBtn.addEventListener("click",pause)
resetBtn.addEventListener("click",reset)

modeButtons.forEach(btn=>{
    btn.addEventListener("click",()=>{
        setMode(parseInt(btn.dataset.time))
    })
})

document.addEventListener("visibilitychange",()=>{

    if(document.hidden){

        if(interval){
            clearInterval(interval)
        }

    }else{

        if(interval === null && remaining > 0){

            interval = setInterval(tick,1000)

        }

    }

})

render()