document.addEventListener('DOMContentLoaded', function() {
    // ---------------------------------------------------
    // 表单提交处理（原有的功能）
    // ---------------------------------------------------
    const contactForm = document.querySelector('#contact form');

    if (contactForm) {
        contactForm.addEventListener('submit', function(event) {
            event.preventDefault(); // 阻止表单默认提交行为

            const name = document.getElementById('name').value;
            const email = document.getElementById('email').value;
            const message = document.getElementById('message').value;

            if (name && email && message) {
                alert('感谢您的留言，我们会尽快回复！');
                this.reset(); // 清空表单
            } else {
                alert('请填写所有必填字段。');
            }
        });
    }

    // ---------------------------------------------------
    // 滚动动画效果
    // ---------------------------------------------------
    const animatedSections = document.querySelectorAll('.animated-section');

    const observerOptions = {
        root: null, // 视口为根
        rootMargin: '0px', // 没有额外的边距
        threshold: 0.2 // 当元素20%进入视口时触发
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // 如果元素进入视口，添加 'is-visible' 类
                entry.target.classList.add('is-visible');
                // 一旦动画触发，可以取消观察这个元素，避免重复触发
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // 观察所有带有 'animated-section' 类的元素
    animatedSections.forEach(section => {
        observer.observe(section);
    });
});
